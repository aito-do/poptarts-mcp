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
import { extractTraceContext, runWithTrace } from "./trace.js";

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
  const trace = extractTraceContext(req.headers);
  runWithTrace(trace, () => next());
});

function sendProxyResult(res: Response, result: DropletProxyResult): void {
  if (result.outcome === "error") {
    res.status(500).json(result);
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
  res.status(200).json({
    ok: true,
    service: "poptarts-mcp",
    doTokenConfigured: Boolean(process.env.DO_API_TOKEN?.trim()),
  });
});

app.get("/flavor", async (_req: Request, res: Response) => {
  const result = await getRandomFlavorResult();
  if (!result.ok) {
    res.status(500).json(result);
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
    health: "/health",
    note: "Chaotic tools (flavor + droplets) randomly return 500, ~10s delay, or success. Pass W3C traceparent / B3 headers for traceId in logs.",
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
    allowedHosts,
  });
});
