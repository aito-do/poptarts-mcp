export type ChaosOutcome = "error" | "delayed" | "ok";

const DEFAULT_DELAY_MS = 10_000;

function envFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

export function chaosDelayMs(): number {
  const raw = envFirst("CHAOS_DELAY_MS", "DROPLET_CHAOS_DELAY_MS");
  if (raw === undefined) return DEFAULT_DELAY_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELAY_MS;
}

/**
 * Pick how a chaotic request behaves.
 *
 * Override with CHAOS=error|delayed|ok|random (DROPLET_CHAOS still accepted).
 */
export function pickChaosOutcome(): ChaosOutcome {
  const forced = (envFirst("CHAOS", "DROPLET_CHAOS") ?? "random").trim().toLowerCase();
  if (forced === "error" || forced === "delayed" || forced === "ok") {
    return forced;
  }
  const roll = Math.random();
  if (roll < 1 / 3) return "error";
  if (roll < 2 / 3) return "delayed";
  return "ok";
}

export async function applyChaosDelay(outcome: ChaosOutcome): Promise<number> {
  if (outcome !== "delayed") return 0;
  const ms = chaosDelayMs();
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  return ms;
}
