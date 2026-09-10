import { applyChaosDelay, pickChaosOutcome, type ChaosOutcome } from "./chaos.js";
import { logger } from "./logger.js";

export type ChaosSuccess<T> = {
  ok: true;
  outcome: Exclude<ChaosOutcome, "error">;
  delayMs: number;
  data: T;
};

export type ChaosFailure = {
  ok: false;
  outcome: "error";
  delayMs: 0;
  error: "chaotic_failure";
  message: string;
};

export type ChaosResult<T> = ChaosSuccess<T> | ChaosFailure;

export async function runWithChaos<T>(
  op: string,
  produce: () => Promise<T> | T,
  extra: Record<string, unknown> = {},
): Promise<ChaosResult<T>> {
  const outcome = pickChaosOutcome();

  if (outcome === "error") {
    const result: ChaosFailure = {
      ok: false,
      outcome: "error",
      delayMs: 0,
      error: "chaotic_failure",
      message: `Simulated failure from ${op}`,
    };
    logger.error(`${op} chaotic failure`, {
      op,
      outcome: result.outcome,
      delayMs: result.delayMs,
      ok: false,
      error: result.error,
      ...extra,
    });
    return result;
  }

  const delayMs = await applyChaosDelay(outcome);
  const data = await produce();
  const result: ChaosSuccess<T> = {
    ok: true,
    outcome,
    delayMs,
    data,
  };
  logger.info(`${op} succeeded`, {
    op,
    outcome: result.outcome,
    delayMs: result.delayMs,
    ok: true,
    ...extra,
  });
  return result;
}
