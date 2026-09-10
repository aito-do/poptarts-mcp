import { AsyncLocalStorage } from "node:async_hooks";
import {
  BAGGAGE_META_KEY,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
} from "@modelcontextprotocol/server";

export type TraceContext = {
  traceId?: string;
  spanId?: string;
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
  /** Where the chosen traceparent came from. */
  traceSource?: "mcp_meta" | "http_header" | "b3_header" | "none";
};

type RequestStore = {
  trace: TraceContext;
  /** All inbound HTTP headers (Authorization redacted). */
  headers?: Record<string, string>;
  /** MCP params._meta when present. */
  mcpMeta?: Record<string, unknown>;
};

const als = new AsyncLocalStorage<RequestStore>();

/** W3C Trace Context: `version-traceid-spanid-flags` (trace-id = 32 hex). */
const TRACEPARENT_RE =
  /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;

const REDACT_HEADER = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

function headerValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(name);
    return value?.trim() || undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const raw = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.trim() || undefined;
  return raw?.trim() || undefined;
}

/** Flatten inbound headers for logging; redact secrets. */
export function flattenHeaders(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  if (!headers) return {};

  const out: Record<string, string> = {};

  if (typeof (headers as Headers).forEach === "function") {
    (headers as Headers).forEach((value, key) => {
      out[key.toLowerCase()] = REDACT_HEADER.test(key) ? "[redacted]" : value;
    });
    return out;
  }

  for (const [key, raw] of Object.entries(
    headers as Record<string, string | string[] | undefined>,
  )) {
    if (raw === undefined) continue;
    const value = Array.isArray(raw) ? raw.join(", ") : raw;
    out[key.toLowerCase()] = REDACT_HEADER.test(key) ? "[redacted]" : value;
  }
  return out;
}

function parseTraceparent(
  traceparent: string | undefined,
  tracestate: string | undefined,
  source: TraceContext["traceSource"],
): TraceContext | undefined {
  if (!traceparent) return undefined;
  const match = TRACEPARENT_RE.exec(traceparent);
  if (match) {
    return {
      traceId: match[2]!.toLowerCase(),
      spanId: match[3]!.toLowerCase(),
      traceparent,
      tracestate,
      traceSource: source,
    };
  }
  return { traceparent, tracestate, traceSource: source };
}

function metaString(
  meta: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!meta) return undefined;
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Pull OpenTelemetry / distributed-trace identifiers.
 *
 * Preference order (MCP clients often stamp W3C context on params._meta,
 * while gateways may inject a different HTTP traceparent):
 * 1. MCP `_meta.traceparent` / `_meta.tracestate`
 * 2. HTTP `traceparent` / `tracestate`
 * 3. Zipkin B3 `x-b3-traceid` / `x-b3-spanid`
 */
export function extractTraceContext(options: {
  headers?: Headers | Record<string, string | string[] | undefined>;
  mcpMeta?: Record<string, unknown>;
} = {}): TraceContext {
  const { headers, mcpMeta } = options;

  const fromMeta = parseTraceparent(
    metaString(mcpMeta, TRACEPARENT_META_KEY),
    metaString(mcpMeta, TRACESTATE_META_KEY),
    "mcp_meta",
  );
  if (fromMeta?.traceId || fromMeta?.traceparent) {
    return {
      ...fromMeta,
      baggage: metaString(mcpMeta, BAGGAGE_META_KEY),
    };
  }

  if (headers) {
    const fromHeader = parseTraceparent(
      headerValue(headers, "traceparent"),
      headerValue(headers, "tracestate"),
      "http_header",
    );
    if (fromHeader?.traceId || fromHeader?.traceparent) {
      return {
        ...fromHeader,
        baggage: headerValue(headers, "baggage"),
      };
    }

    const b3TraceId = headerValue(headers, "x-b3-traceid");
    const b3SpanId = headerValue(headers, "x-b3-spanid");
    if (b3TraceId) {
      return {
        traceId: b3TraceId.toLowerCase(),
        spanId: b3SpanId?.toLowerCase(),
        baggage: headerValue(headers, "baggage"),
        traceSource: "b3_header",
      };
    }
  }

  return { traceSource: "none" };
}

export function runWithRequestContext<T>(
  store: RequestStore,
  fn: () => T,
): T {
  return als.run(store, fn);
}

/** @deprecated Prefer runWithRequestContext */
export function runWithTrace<T>(trace: TraceContext, fn: () => T): T {
  return als.run({ trace }, fn);
}

export function getRequestStore(): RequestStore | undefined {
  return als.getStore();
}

export function getTraceContext(): TraceContext {
  return als.getStore()?.trace ?? {};
}

/** Flat fields suitable for structured logs. */
export function traceLogFields(
  store: RequestStore | undefined = getRequestStore(),
): Record<string, unknown> {
  const trace = store?.trace ?? {};
  const fields: Record<string, unknown> = {};
  if (trace.traceId) fields.traceId = trace.traceId;
  if (trace.spanId) fields.spanId = trace.spanId;
  if (trace.traceparent) fields.traceparent = trace.traceparent;
  if (trace.tracestate) fields.tracestate = trace.tracestate;
  if (trace.baggage) fields.baggage = trace.baggage;
  if (trace.traceSource) fields.traceSource = trace.traceSource;
  if (store?.headers) fields.headers = store.headers;
  if (store?.mcpMeta) fields.mcpMeta = store.mcpMeta;
  return fields;
}
