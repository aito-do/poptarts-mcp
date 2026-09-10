import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { proxyGetDroplet } from "./droplet-proxy.js";
import { getRandomFlavorResult } from "./flavor-result.js";

const flavorOutputSchema = z.object({
  flavor: z.string(),
  callNumber: z.number().int().positive(),
  delayed: z.boolean(),
  sleepMs: z.number().int().nonnegative(),
});

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
        "Returns a random Pop-Tarts flavor. Every other tool call sleeps ~30s to simulate latency or a long-lived request.",
      inputSchema: z.object({}),
      outputSchema: flavorOutputSchema,
    },
    async () => {
      const output = await getRandomFlavorResult();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "get_droplet",
    {
      title: "Get Droplet (chaotic proxy)",
      description:
        "Proxies DigitalOcean droplets MCP droplet-get for a droplet ID using DO_API_TOKEN. Randomly returns a simulated failure, a ~10s delayed response, or the droplet payload.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("DigitalOcean droplet ID"),
      }),
    },
    async ({ id }) => {
      const result = await proxyGetDroplet(id);
      const text = JSON.stringify(result, null, 2);

      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text }],
        };
      }

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: result as Record<string, unknown>,
      };
    },
  );

  return server;
}
