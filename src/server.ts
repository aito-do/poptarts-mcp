import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { proxyGetDroplet, proxyListDroplets } from "./droplet-proxy.js";
import { getRandomFlavorResult } from "./flavor-result.js";
import {
  extractTraceContext,
  runWithRequestContext,
} from "./trace.js";
import {
  getValkeyCpuBurnStatus,
  startValkeyCpuBurn,
  stopValkeyCpuBurn,
} from "./valkey-cpu-burn.js";

function toolResultFromProxy(result: { ok: boolean }) {
  const text = JSON.stringify(result, null, 2);
  if (!result.ok) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text }],
    };
  }
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: result as Record<string, unknown>,
  };
}

function withRequestContext<T>(
  ctx: {
    http?: { req?: Request };
    mcpReq?: { _meta?: Record<string, unknown> };
  },
  fn: () => Promise<T>,
): Promise<T> {
  const mcpMeta =
    ctx.mcpReq?._meta && typeof ctx.mcpReq._meta === "object"
      ? (ctx.mcpReq._meta as Record<string, unknown>)
      : undefined;
  const trace = extractTraceContext({
    headers: ctx.http?.req?.headers,
    mcpMeta,
  });
  return runWithRequestContext({ trace }, fn);
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "poptarts-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_random_poptart_flavor",
    {
      title: "Random Pop-Tarts Flavor",
      description:
        "Returns a random Pop-Tarts flavor. Randomly returns a simulated 4xx/5xx failure, a ~10s delayed response, or the flavor (same chaos as droplet tools).",
      inputSchema: z.object({}),
    },
    async (_args, ctx) =>
      withRequestContext(ctx, async () =>
        toolResultFromProxy(await getRandomFlavorResult()),
      ),
  );

  server.registerTool(
    "get_droplet",
    {
      title: "Get Droplet (chaotic proxy)",
      description:
        "Proxies DigitalOcean droplets MCP droplet-get for a droplet ID using DO_API_TOKEN. Randomly returns a simulated 4xx/5xx failure, a ~10s delayed response, or the droplet payload.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("DigitalOcean droplet ID"),
      }),
    },
    async ({ id }, ctx) =>
      withRequestContext(ctx, async () => toolResultFromProxy(await proxyGetDroplet(id))),
  );

  server.registerTool(
    "list_droplets",
    {
      title: "List Droplets (chaotic proxy)",
      description:
        "Proxies DigitalOcean droplets MCP droplet-list using DO_API_TOKEN. Randomly returns a simulated 4xx/5xx failure, a ~10s delayed response, or the droplet list.",
      inputSchema: z.object({
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Page number (default 1)"),
        perPage: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Results per page (default 50, max 200)"),
      }),
    },
    async ({ page, perPage }, ctx) =>
      withRequestContext(ctx, async () =>
        toolResultFromProxy(await proxyListDroplets({ page, perPage })),
      ),
  );

  server.registerTool(
    "start_valkey_cpu_burn",
    {
      title: "Start Valkey CPU burn job",
      description:
        "Starts one stackable Valkey CPU burn job (one TCP connection, Lua EVAL loop). Default duration 5 minutes. Call repeatedly — jobs stack and keep the Valkey command thread busy. Requires VALKEY_URL.",
      inputSchema: z.object({
        iterations: z
          .number()
          .int()
          .positive()
          .max(50_000_000)
          .optional()
          .describe("Lua loop iterations per EVAL (default 2e6)"),
        durationMs: z
          .number()
          .int()
          .positive()
          .max(60 * 60_000)
          .optional()
          .describe("How long this job runs (default 300000 = 5m)"),
      }),
    },
    async (args, ctx) =>
      withRequestContext(ctx, async () => {
        const result = startValkeyCpuBurn(args);
        const text = JSON.stringify(result, null, 2);
        if (!result.ok) {
          return { isError: true as const, content: [{ type: "text" as const, text }] };
        }
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: result as Record<string, unknown>,
        };
      }),
  );

  server.registerTool(
    "stop_valkey_cpu_burn",
    {
      title: "Stop all Valkey CPU burn jobs",
      description: "Aborts every active stackable Valkey CPU burn job.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) =>
      withRequestContext(ctx, async () => {
        const result = await stopValkeyCpuBurn();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      }),
  );

  server.registerTool(
    "get_valkey_cpu_burn_status",
    {
      title: "Valkey CPU burn status",
      description: "Returns active burn job count and a sample of running jobs.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) =>
      withRequestContext(ctx, async () => {
        const status = getValkeyCpuBurnStatus();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true, status }, null, 2),
            },
          ],
          structuredContent: { ok: true, status } as Record<string, unknown>,
        };
      }),
  );

  return server;
}
