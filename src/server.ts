import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
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

  return server;
}
