import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Request, Response } from "express";
import { proxyGetDroplet } from "./droplet-proxy.js";
import { getRandomFlavorResult } from "./flavor-result.js";
import { createServer } from "./server.js";

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

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: "poptarts-mcp",
    doTokenConfigured: Boolean(process.env.DO_API_TOKEN?.trim()),
  });
});

app.get("/flavor", async (_req: Request, res: Response) => {
  const result = await getRandomFlavorResult();
  res.status(200).json(result);
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
    const result = await proxyGetDroplet(id);

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
  } catch (err) {
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
    health: "/health",
    note: "GET /droplet/:id and MCP get_droplet proxy droplet-get via DO_API_TOKEN with chaotic 500 / delay / success outcomes",
  });
});

app.all("/mcp", (req: Request, res: Response) => {
  void nodeHandler(req, res, req.body);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`poptarts-mcp listening on 0.0.0.0:${port}`);
  console.log(`MCP endpoint: http://0.0.0.0:${port}/mcp`);
  console.log(`GET flavor: http://0.0.0.0:${port}/flavor`);
  console.log(`GET droplet: http://0.0.0.0:${port}/droplet/:id`);
  console.log(
    `DO_API_TOKEN: ${process.env.DO_API_TOKEN?.trim() ? "configured" : "missing"}`,
  );
  if (allowedHosts.length > 0) {
    console.log(`Allowed hosts: ${allowedHosts.join(", ")}`);
  }
});
