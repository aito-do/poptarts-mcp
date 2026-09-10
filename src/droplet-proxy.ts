import {
  applyChaosDelay,
  chaosHttpStatus,
  isChaosErrorOutcome,
  pickChaosOutcome,
  type ChaosOutcome,
} from "./chaos.js";
import { DoApiError, getDroplet, listDroplets } from "./do-client.js";
import { logger } from "./logger.js";

type ProxyBase = {
  outcome: ChaosOutcome;
  delayMs: number;
};

export type DropletProxySuccess = ProxyBase & {
  ok: true;
  outcome: Exclude<ChaosOutcome, "error_4xx" | "error_5xx">;
  data: unknown;
};

export type DropletProxyChaosError = ProxyBase & {
  ok: false;
  outcome: "error_4xx" | "error_5xx";
  delayMs: 0;
  status: number;
  error: "chaotic_failure";
  message: string;
};

export type DropletProxyApiError = ProxyBase & {
  ok: false;
  outcome: Exclude<ChaosOutcome, "error_4xx" | "error_5xx">;
  error: "do_api_error";
  status: number;
  message: string;
  data: unknown;
};

export type DropletProxyResult =
  | DropletProxySuccess
  | DropletProxyChaosError
  | DropletProxyApiError;

export type GetDropletResult = DropletProxyResult & { op: "get_droplet"; dropletId: number };
export type ListDropletsResult = DropletProxyResult & {
  op: "list_droplets";
  page: number;
  perPage: number;
};

function logProxyResult(
  op: string,
  result: DropletProxyResult,
  extra: Record<string, unknown>,
): void {
  const fields = {
    op,
    outcome: result.outcome,
    delayMs: result.delayMs,
    ok: result.ok,
    ...extra,
  };

  if (result.ok) {
    logger.info(`${op} succeeded`, fields);
    return;
  }

  if (result.error === "chaotic_failure") {
    logger.error(`${op} chaotic failure`, {
      ...fields,
      error: result.error,
      status: result.status,
    });
    return;
  }

  logger.error(`${op} API error`, {
    ...fields,
    error: result.error,
    status: result.status,
    message: result.message,
  });
}

async function runChaoticFetch(
  fetchData: () => Promise<unknown>,
): Promise<DropletProxyResult> {
  const outcome = pickChaosOutcome();

  if (isChaosErrorOutcome(outcome)) {
    const status = chaosHttpStatus(outcome);
    return {
      ok: false,
      outcome,
      delayMs: 0,
      status,
      error: "chaotic_failure",
      message: `Simulated ${status} failure from droplet proxy`,
    };
  }

  const delayMs = await applyChaosDelay(outcome);

  try {
    const data = await fetchData();
    return {
      ok: true,
      outcome,
      delayMs,
      data,
    };
  } catch (err) {
    if (err instanceof DoApiError) {
      return {
        ok: false,
        outcome,
        delayMs,
        error: "do_api_error",
        status: err.status,
        message: err.message,
        data: err.body,
      };
    }
    throw err;
  }
}

/**
 * Proxy droplet-get with chaotic outcomes: simulated 4xx/5xx, delayed
 * success, or immediate success.
 */
export async function proxyGetDroplet(dropletId: number): Promise<GetDropletResult> {
  const result = await runChaoticFetch(() => getDroplet(dropletId));
  const wrapped: GetDropletResult = { ...result, op: "get_droplet", dropletId };
  logProxyResult("get_droplet", result, { dropletId });
  return wrapped;
}

/**
 * Proxy droplet-list with the same chaotic outcomes as get.
 */
export async function proxyListDroplets(options: {
  page?: number;
  perPage?: number;
} = {}): Promise<ListDropletsResult> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 50;
  const result = await runChaoticFetch(() => listDroplets({ page, perPage }));
  const wrapped: ListDropletsResult = {
    ...result,
    op: "list_droplets",
    page,
    perPage,
  };
  logProxyResult("list_droplets", result, { page, perPage });
  return wrapped;
}
