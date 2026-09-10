import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { pickRandomFlavor } from "./flavors.js";
import { maybeSimulateLatency } from "./latency.js";

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
      const latency = await maybeSimulateLatency();
      const flavor = pickRandomFlavor();
      const output = {
        flavor,
        callNumber: latency.callNumber,
        delayed: latency.delayed,
        sleepMs: latency.sleepMs,
      };
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

  return server;
}
