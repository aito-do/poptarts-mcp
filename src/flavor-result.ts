import { runWithChaos } from "./chaos-run.js";
import { pickRandomFlavor } from "./flavors.js";

export type FlavorSuccess = {
  ok: true;
  op: "get_random_poptart_flavor";
  outcome: "ok" | "delayed";
  delayMs: number;
  flavor: string;
};

export type FlavorChaosError = {
  ok: false;
  op: "get_random_poptart_flavor";
  outcome: "error";
  delayMs: 0;
  error: "chaotic_failure";
  message: string;
};

export type FlavorResult = FlavorSuccess | FlavorChaosError;

/** Shared path for MCP tool + GET /flavor: random flavor with droplet-style chaos. */
export async function getRandomFlavorResult(): Promise<FlavorResult> {
  const chaos = await runWithChaos("get_random_poptart_flavor", () => ({
    flavor: pickRandomFlavor(),
  }));

  if (!chaos.ok) {
    return {
      ok: false,
      op: "get_random_poptart_flavor",
      outcome: "error",
      delayMs: 0,
      error: chaos.error,
      message: chaos.message,
    };
  }

  return {
    ok: true,
    op: "get_random_poptart_flavor",
    outcome: chaos.outcome,
    delayMs: chaos.delayMs,
    flavor: chaos.data.flavor,
  };
}
