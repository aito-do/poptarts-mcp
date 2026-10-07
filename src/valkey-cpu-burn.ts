import { createClient, type RedisClientType } from "redis";
import { logger } from "./logger.js";

/** Lua script that burns CPU on the Valkey/Redis server (not the client). */
const CPU_BURN_LUA = `
local n = tonumber(ARGV[1]) or 1000000
local x = 0
for i = 1, n do
  x = x + i
  if i % 97 == 0 then
    x = x ~ i
  end
end
return x
`;

const DEFAULT_ITERATIONS = 2_000_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_DURATION_MS = 60_000;

export type ValkeyCpuBurnStatus = {
  running: boolean;
  configured: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  iterations: number;
  concurrency: number;
  maxDurationMs: number;
  evalsCompleted: number;
  lastError: string | null;
};

type BurnOptions = {
  iterations?: number;
  concurrency?: number;
  maxDurationMs?: number;
};

type BurnState = {
  running: boolean;
  abort: AbortController | null;
  client: RedisClientType | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  iterations: number;
  concurrency: number;
  maxDurationMs: number;
  evalsCompleted: number;
  lastError: string | null;
  loopPromise: Promise<void> | null;
};

const state: BurnState = {
  running: false,
  abort: null,
  client: null,
  startedAt: null,
  stoppedAt: null,
  iterations: DEFAULT_ITERATIONS,
  concurrency: DEFAULT_CONCURRENCY,
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  evalsCompleted: 0,
  lastError: null,
  loopPromise: null,
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function valkeyUrlConfigured(): boolean {
  return Boolean(resolveValkeyUrl());
}

function resolveValkeyUrl(): string | undefined {
  for (const name of ["VALKEY_URL", "REDIS_URL", "DATABASE_URL"]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function clampOptions(options: BurnOptions = {}): Required<BurnOptions> {
  const iterations = Math.min(
    Math.max(1, options.iterations ?? envInt("VALKEY_CPU_BURN_ITERATIONS", DEFAULT_ITERATIONS)),
    50_000_000,
  );
  const concurrency = Math.min(
    Math.max(1, options.concurrency ?? envInt("VALKEY_CPU_BURN_CONCURRENCY", DEFAULT_CONCURRENCY)),
    32,
  );
  const maxDurationMs = Math.min(
    Math.max(
      1_000,
      options.maxDurationMs ??
        envInt("VALKEY_CPU_BURN_MAX_DURATION_MS", DEFAULT_MAX_DURATION_MS),
    ),
    30 * 60_000,
  );
  return { iterations, concurrency, maxDurationMs };
}

export function getValkeyCpuBurnStatus(): ValkeyCpuBurnStatus {
  return {
    running: state.running,
    configured: valkeyUrlConfigured(),
    startedAt: state.startedAt?.toISOString() ?? null,
    stoppedAt: state.stoppedAt?.toISOString() ?? null,
    iterations: state.iterations,
    concurrency: state.concurrency,
    maxDurationMs: state.maxDurationMs,
    evalsCompleted: state.evalsCompleted,
    lastError: state.lastError,
  };
}

async function connectClient(): Promise<RedisClientType> {
  const url = resolveValkeyUrl();
  if (!url) {
    throw new Error(
      "VALKEY_URL (or REDIS_URL / DATABASE_URL) is not configured",
    );
  }

  const client = createClient({ url }) as RedisClientType;
  client.on("error", (err: Error) => {
    state.lastError = err.message;
    logger.error("valkey client error", { message: err.message });
  });
  await client.connect();
  return client;
}

async function runWorker(
  client: RedisClientType,
  signal: AbortSignal,
  iterations: number,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await client.eval(CPU_BURN_LUA, {
        arguments: [String(iterations)],
      });
      state.evalsCompleted += 1;
    } catch (err) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : "Unknown error";
      state.lastError = message;
      logger.error("valkey cpu burn eval failed", { message });
      // Brief pause so a hard failure does not spin the local event loop.
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

async function runBurnLoop(
  client: RedisClientType,
  abort: AbortController,
  options: Required<BurnOptions>,
): Promise<void> {
  const { iterations, concurrency, maxDurationMs } = options;
  const timer = setTimeout(() => {
    logger.info("valkey cpu burn max duration reached", { maxDurationMs });
    abort.abort();
  }, maxDurationMs);

  const workers = Array.from({ length: concurrency }, () =>
    runWorker(client, abort.signal, iterations),
  );

  try {
    await Promise.all(workers);
  } finally {
    clearTimeout(timer);
  }
}

export type StartValkeyCpuBurnResult =
  | { ok: true; status: ValkeyCpuBurnStatus; message: string }
  | { ok: false; error: string; message: string; status: ValkeyCpuBurnStatus };

export async function startValkeyCpuBurn(
  options: BurnOptions = {},
): Promise<StartValkeyCpuBurnResult> {
  if (state.running) {
    return {
      ok: false,
      error: "already_running",
      message: "Valkey CPU burn is already running",
      status: getValkeyCpuBurnStatus(),
    };
  }

  if (!valkeyUrlConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      message: "VALKEY_URL (or REDIS_URL / DATABASE_URL) is not configured",
      status: getValkeyCpuBurnStatus(),
    };
  }

  const clamped = clampOptions(options);
  let client: RedisClientType;
  try {
    client = await connectClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    state.lastError = message;
    return {
      ok: false,
      error: "connect_failed",
      message,
      status: getValkeyCpuBurnStatus(),
    };
  }

  const abort = new AbortController();
  state.running = true;
  state.abort = abort;
  state.client = client;
  state.startedAt = new Date();
  state.stoppedAt = null;
  state.iterations = clamped.iterations;
  state.concurrency = clamped.concurrency;
  state.maxDurationMs = clamped.maxDurationMs;
  state.evalsCompleted = 0;
  state.lastError = null;

  logger.info("valkey cpu burn started", {
    iterations: clamped.iterations,
    concurrency: clamped.concurrency,
    maxDurationMs: clamped.maxDurationMs,
  });

  state.loopPromise = runBurnLoop(client, abort, clamped)
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      state.lastError = message;
      logger.error("valkey cpu burn loop crashed", { message });
    })
    .finally(async () => {
      state.running = false;
      state.stoppedAt = new Date();
      state.abort = null;
      state.loopPromise = null;
      try {
        await client.quit();
      } catch {
        try {
          client.destroy();
        } catch {
          /* ignore */
        }
      }
      state.client = null;
      logger.info("valkey cpu burn stopped", {
        evalsCompleted: state.evalsCompleted,
        lastError: state.lastError,
      });
    });

  return {
    ok: true,
    message: "Valkey CPU burn started (background workers)",
    status: getValkeyCpuBurnStatus(),
  };
}

export type StopValkeyCpuBurnResult = {
  ok: true;
  message: string;
  status: ValkeyCpuBurnStatus;
};

export async function stopValkeyCpuBurn(): Promise<StopValkeyCpuBurnResult> {
  if (!state.running || !state.abort) {
    return {
      ok: true,
      message: "Valkey CPU burn was not running",
      status: getValkeyCpuBurnStatus(),
    };
  }

  state.abort.abort();
  if (state.loopPromise) {
    await state.loopPromise.catch(() => undefined);
  }

  return {
    ok: true,
    message: "Valkey CPU burn stopped",
    status: getValkeyCpuBurnStatus(),
  };
}
