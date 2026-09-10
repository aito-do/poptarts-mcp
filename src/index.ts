import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Request, Response } from "express";
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
  res.status(200).json({ ok: true, service: "poptarts-mcp" });
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    name: "poptarts-mcp",
    mcp: "/mcp",
    health: "/health",
    note: "Streamable HTTP MCP endpoint is POST/GET/DELETE /mcp",
  });
});

app.all("/mcp", (req: Request, res: Response) => {
  void nodeHandler(req, res, req.body);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`poptarts-mcp listening on 0.0.0.0:${port}`);
  console.log(`MCP endpoint: http://0.0.0.0:${port}/mcp`);
  if (allowedHosts.length > 0) {
    console.log(`Allowed hosts: ${allowedHosts.join(", ")}`);
  }
});
