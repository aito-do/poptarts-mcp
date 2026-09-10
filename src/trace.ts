import { AsyncLocalStorage } from "node:async_hooks";

export type TraceContext = {
  traceId?: string;
  spanId?: string;
  traceparent?: string;
  tracestate?: string;
};

type RequestStore = {
  trace: TraceContext;
};

const als = new AsyncLocalStorage<RequestStore>();

/** W3C Trace Context: `version-traceid-spanid-flags` (trace-id = 32 hex). */
const TRACEPARENT_RE =
  /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;

function headerValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(name);
    return value?.trim() || undefined;
  }
  const raw = (headers as Record<string, string | string[] | undefined>)[name]
    ?? (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.trim() || undefined;
  return raw?.trim() || undefined;
}

/**
 * Pull OpenTelemetry / distributed-trace identifiers from inbound headers.
 *
 * Prefers W3C Trace Context (`traceparent` / `tracestate`), then Zipkin B3
 * (`x-b3-traceid` / `x-b3-spanid`).
 */
export function extractTraceContext(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
): TraceContext {
  if (!headers) return {};

  const traceparent = headerValue(headers, "traceparent");
  const tracestate = headerValue(headers, "tracestate");

  if (traceparent) {
    const match = TRACEPARENT_RE.exec(traceparent);
    if (match) {
      return {
        traceId: match[2]!.toLowerCase(),
        spanId: match[3]!.toLowerCase(),
        traceparent,
        tracestate,
      };
    }
    return { traceparent, tracestate };
  }

  const b3TraceId = headerValue(headers, "x-b3-traceid");
  const b3SpanId = headerValue(headers, "x-b3-spanid");
  if (b3TraceId) {
    return {
      traceId: b3TraceId.toLowerCase(),
      spanId: b3SpanId?.toLowerCase(),
    };
  }

  return {};
}

export function runWithTrace<T>(trace: TraceContext, fn: () => T): T {
  return als.run({ trace }, fn);
}

export function getTraceContext(): TraceContext {
  return als.getStore()?.trace ?? {};
}

/** Flat fields suitable for structured logs (`traceId`, `spanId`, …). */
export function traceLogFields(trace: TraceContext = getTraceContext()): Record<string, string> {
  const fields: Record<string, string> = {};
  if (trace.traceId) fields.traceId = trace.traceId;
  if (trace.spanId) fields.spanId = trace.spanId;
  if (trace.traceparent) fields.traceparent = trace.traceparent;
  if (trace.tracestate) fields.tracestate = trace.tracestate;
  return fields;
}
