export type ChaosOutcome = "error_4xx" | "error_5xx" | "delayed" | "ok";

const DEFAULT_DELAY_MS = 10_000;

const CLIENT_ERROR_STATUSES = [400, 401, 403, 404, 429] as const;
const SERVER_ERROR_STATUSES = [500, 502, 503] as const;

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

function pickStatus(statuses: readonly number[]): number {
  return statuses[Math.floor(Math.random() * statuses.length)]!;
}

/** HTTP status for a chaotic client/server error outcome. */
export function chaosHttpStatus(outcome: "error_4xx" | "error_5xx"): number {
  return outcome === "error_4xx"
    ? pickStatus(CLIENT_ERROR_STATUSES)
    : pickStatus(SERVER_ERROR_STATUSES);
}

export function isChaosErrorOutcome(
  outcome: ChaosOutcome,
): outcome is "error_4xx" | "error_5xx" {
  return outcome === "error_4xx" || outcome === "error_5xx";
}

/**
 * Pick how a chaotic request behaves.
 *
 * Override with CHAOS=error_4xx|error_5xx|error|delayed|ok|random
 * (`error` aliases to `error_5xx`; DROPLET_CHAOS still accepted).
 */
export function pickChaosOutcome(): ChaosOutcome {
  const forced = (envFirst("CHAOS", "DROPLET_CHAOS") ?? "random").trim().toLowerCase();
  if (forced === "error" || forced === "error_5xx") return "error_5xx";
  if (forced === "error_4xx" || forced === "4xx") return "error_4xx";
  if (forced === "delayed" || forced === "ok") return forced;

  const roll = Math.random();
  if (roll < 0.25) return "error_4xx";
  if (roll < 0.5) return "error_5xx";
  if (roll < 0.75) return "delayed";
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
