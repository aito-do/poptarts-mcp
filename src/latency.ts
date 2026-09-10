/**
 * Alternating latency gate: odd tool calls return immediately; even calls
 * sleep to simulate long-lived / high-latency requests.
 *
 * Counter is process-local (fine for a single App Platform instance).
 */
let callCount = 0;

const sleepMs = (): number => {
  const raw = process.env.POPTARTS_SLEEP_MS;
  if (raw === undefined || raw === "") return 30_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
};

export type LatencyDecision = {
  callNumber: number;
  delayed: boolean;
  sleepMs: number;
};

export async function maybeSimulateLatency(): Promise<LatencyDecision> {
  callCount += 1;
  const delayed = callCount % 2 === 0;
  const ms = delayed ? sleepMs() : 0;
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  return { callNumber: callCount, delayed, sleepMs: ms };
}

/** Test helper — not used in production paths. */
export function resetCallCount(): void {
  callCount = 0;
}
