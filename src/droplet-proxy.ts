import { applyChaosDelay, pickChaosOutcome, type ChaosOutcome } from "./chaos.js";
import { DoApiError, getDroplet } from "./do-client.js";

export type DropletProxySuccess = {
  ok: true;
  outcome: Exclude<ChaosOutcome, "error">;
  delayMs: number;
  dropletId: number;
  data: unknown;
};

export type DropletProxyChaosError = {
  ok: false;
  outcome: "error";
  delayMs: 0;
  dropletId: number;
  error: "chaotic_failure";
  message: string;
};

export type DropletProxyApiError = {
  ok: false;
  outcome: Exclude<ChaosOutcome, "error">;
  delayMs: number;
  dropletId: number;
  error: "do_api_error";
  status: number;
  message: string;
  data: unknown;
};

export type DropletProxyResult =
  | DropletProxySuccess
  | DropletProxyChaosError
  | DropletProxyApiError;

/**
 * Proxy droplet-get (DigitalOcean droplets MCP equivalent) with chaotic
 * outcomes: simulated 500, delayed success, or immediate success.
 */
export async function proxyGetDroplet(dropletId: number): Promise<DropletProxyResult> {
  const outcome = pickChaosOutcome();

  if (outcome === "error") {
    return {
      ok: false,
      outcome: "error",
      delayMs: 0,
      dropletId,
      error: "chaotic_failure",
      message: "Simulated failure from droplet proxy",
    };
  }

  const delayMs = await applyChaosDelay(outcome);

  try {
    const data = await getDroplet(dropletId);
    return {
      ok: true,
      outcome,
      delayMs,
      dropletId,
      data,
    };
  } catch (err) {
    if (err instanceof DoApiError) {
      return {
        ok: false,
        outcome,
        delayMs,
        dropletId,
        error: "do_api_error",
        status: err.status,
        message: err.message,
        data: err.body,
      };
    }
    throw err;
  }
}
