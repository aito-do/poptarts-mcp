export type ChaosOutcome = "error" | "delayed" | "ok";

const DEFAULT_DELAY_MS = 10_000;

export function chaosDelayMs(): number {
  const raw = process.env.DROPLET_CHAOS_DELAY_MS;
  if (raw === undefined || raw === "") return DEFAULT_DELAY_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELAY_MS;
}

/**
 * Pick how a droplet request behaves.
 *
 * Override with DROPLET_CHAOS=error|delayed|ok|random (default random).
 */
export function pickChaosOutcome(): ChaosOutcome {
  const forced = (process.env.DROPLET_CHAOS ?? "random").trim().toLowerCase();
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
