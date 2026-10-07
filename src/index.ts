import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { NextFunction, Request, Response } from "express";
import {
  proxyGetDroplet,
  proxyListDroplets,
  type DropletProxyResult,
} from "./droplet-proxy.js";
import { getRandomFlavorResult } from "./flavor-result.js";
import { logger } from "./logger.js";
import { createServer } from "./server.js";
import {
  extractTraceContext,
  runWithRequestContext,
} from "./trace.js";
import {
  getValkeyCpuBurnStatus,
  startValkeyCpuBurn,
  stopValkeyCpuBurn,
  valkeyUrlConfigured,
} from "./valkey-cpu-burn.js";

const port = Number(process.env.PORT ?? 8080);
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const app = createMcpExpressApp({
  host: "0.0.0.0",
  ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
});

const handler = createMcpHandler(() => createServer());
const nodeHandler = toNodeHandler(handler);

app.use((req: Request, _res: Response, next: NextFunction) => {
  const trace = extractTraceContext({ headers: req.headers });
  runWithRequestContext({ trace }, () => next());
});

function sendProxyResult(res: Response, result: DropletProxyResult): void {
  if (!result.ok && result.error === "chaotic_failure") {
    res.status(result.status).json(result);
    return;
  }

  if (!result.ok) {
    const status =
      result.error === "do_api_error" && result.status >= 400 && result.status < 600
        ? result.status
        : 502;
    res.status(status).json(result);
    return;
  }

  res.status(200).json(result);
}

app.get("/health", (_req: Request, res: Response) => {
  const burn = getValkeyCpuBurnStatus();
  res.status(200).json({
    ok: true,
    service: "poptarts-mcp",
    doTokenConfigured: Boolean(process.env.DO_API_TOKEN?.trim()),
    valkeyConfigured: valkeyUrlConfigured(),
    valkeyCpuBurnActiveJobs: burn.activeJobs,
  });
});

function parseBurnBody(body: unknown): {
  ok: true;
  options: { iterations?: number; durationMs?: number };
} | {
  ok: false;
  error: string;
  message: string;
} {
  const raw = (body ?? {}) as {
    iterations?: unknown;
    durationMs?: unknown;
    maxDurationMs?: unknown;
  };

  const asPositiveInt = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : Number.NaN;
  };

  const iterations = asPositiveInt(raw.iterations);
  // Accept durationMs or legacy maxDurationMs.
  const durationMs = asPositiveInt(
    raw.durationMs !== undefined ? raw.durationMs : raw.maxDurationMs,
  );

  if (Number.isNaN(iterations) || Number.isNaN(durationMs)) {
    return {
      ok: false,
      error: "invalid_options",
      message: "iterations and durationMs must be positive integers when set",
    };
  }

  return {
    ok: true,
    options: {
      ...(iterations !== undefined ? { iterations } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  };
}

function handleCpuBurnStart(req: Request, res: Response): void {
  const parsed = parseBurnBody(req.body);
  if (!parsed.ok) {
    logger.info("valkey cpu burn request", {
      params: req.body ?? {},
      error: parsed.error,
    });
    res.status(400).json({ ok: false, error: parsed.error, message: parsed.message });
    return;
  }

  const result = startValkeyCpuBurn(parsed.options);
  const status =
    result.ok ? 202 : result.error === "max_jobs" ? 503 : 400;
  res.status(status).json(result);
}

app.get("/valkey/cpu-burn", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, status: getValkeyCpuBurnStatus() });
});

// Each POST starts a new stackable 5-minute burn job.
app.post("/valkey/cpu-burn", (req: Request, res: Response) => {
  handleCpuBurnStart(req, res);
});

app.post("/valkey/cpu-burn/start", (req: Request, res: Response) => {
  handleCpuBurnStart(req, res);
});

app.post("/valkey/cpu-burn/stop", async (_req: Request, res: Response) => {
  const result = await stopValkeyCpuBurn();
  res.status(200).json(result);
});

app.get("/flavor", async (_req: Request, res: Response) => {
  const result = await getRandomFlavorResult();
  if (!result.ok) {
    res.status(result.status).json(result);
    return;
  }
  res.status(200).json(result);
});

app.get("/droplets", async (req: Request, res: Response) => {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const perPage = req.query.per_page === undefined ? 50 : Number(req.query.per_page);

  if (!Number.isInteger(page) || page <= 0 || !Number.isInteger(perPage) || perPage <= 0) {
    res.status(400).json({
      ok: false,
      error: "invalid_pagination",
      message: "page and per_page must be positive integers",
    });
    return;
  }

  try {
    sendProxyResult(res, await proxyListDroplets({ page, perPage }));
  } catch (err) {
    logger.error("list_droplets unexpected failure", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    res.status(500).json({
      ok: false,
      error: "internal_error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

app.get("/droplet/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      ok: false,
      error: "invalid_id",
      message: "Droplet id must be a positive integer",
    });
    return;
  }

  try {
    sendProxyResult(res, await proxyGetDroplet(id));
  } catch (err) {
    logger.error("get_droplet unexpected failure", {
      dropletId: id,
      message: err instanceof Error ? err.message : "Unknown error",
    });
    res.status(500).json({
      ok: false,
      error: "internal_error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    name: "poptarts-mcp",
    mcp: "/mcp",
    flavor: "/flavor",
    droplet: "/droplet/:id",
    droplets: "/droplets",
    valkeyCpuBurn: {
      status: "GET /valkey/cpu-burn",
      start: "POST /valkey/cpu-burn (or /start) — each call stacks a 5m job",
      stop: "POST /valkey/cpu-burn/stop — abort all jobs",
    },
    health: "/health",
    note: "Chaotic tools randomly return 4xx, 5xx, ~10s delay, or success. POST /valkey/cpu-burn stacks a 5-minute Valkey CPU burn job per request. Trace from MCP _meta.traceparent (preferred) or HTTP traceparent/B3.",
  });
});

app.all("/mcp", (req: Request, res: Response) => {
  void nodeHandler(req, res, req.body);
});

app.listen(port, "0.0.0.0", () => {
  logger.info("poptarts-mcp listening", {
    host: "0.0.0.0",
    port,
    doTokenConfigured: Boolean(process.env.DO_API_TOKEN?.trim()),
    valkeyConfigured: valkeyUrlConfigured(),
    allowedHosts,
  });
});
