import { createClient, type RedisClientType } from "redis";
import { logger } from "./logger.js";

/**
 * CPU-heavy Lua for the Valkey main thread. Each HTTP/MCP request
 * starts one independent job (one TCP connection) that loops this for
 * ~5 minutes. Stack many requests to keep the command queue full.
 */
// Valkey/Redis embed Lua 5.1 — no bitwise `~` / `bit` ops. Keep this 5.1-safe.
const CPU_BURN_LUA = `
local n = tonumber(ARGV[1]) or 2000000
local x = 0
local s = "poptarts-valkey-cpu-burn"
for i = 1, n do
  x = x + i * 2654435761
  if x > 1e15 then
    x = x % 2147483647
  end
  if i % 64 == 0 then
    s = string.sub(s .. tostring(x), -64)
    x = x + #s
  end
end
return x
`;

const DEFAULT_ITERATIONS = 2_000_000;
const DEFAULT_DURATION_MS = 5 * 60_000;
const MAX_ITERATIONS = 50_000_000;
const MAX_DURATION_MS = 60 * 60_000;
const DEFAULT_MAX_JOBS = 2_500;

export type BurnJobOptions = {
  iterations?: number;
  /** How long this job runs. Default 5 minutes. */
  durationMs?: number;
};

export type BurnJobSummary = {
  id: string;
  startedAt: string;
  endsAt: string;
  durationMs: number;
  iterations: number;
  evalsCompleted: number;
  lastError: string | null;
};

export type ValkeyCpuBurnStatus = {
  configured: boolean;
  activeJobs: number;
  maxJobs: number;
  totalStarted: number;
  totalFinished: number;
  totalEvalsCompleted: number;
  jobs: BurnJobSummary[];
};

type JobRecord = {
  id: string;
  startedAt: Date;
  endsAt: Date;
  durationMs: number;
  iterations: number;
  evalsCompleted: number;
  lastError: string | null;
  abort: AbortController;
  promise: Promise<void>;
};

const jobs = new Map<string, JobRecord>();
let totalStarted = 0;
let totalFinished = 0;
let totalEvalsCompleted = 0;
let jobSeq = 0;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
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

function maxJobs(): number {
  return Math.max(1, envInt("VALKEY_CPU_BURN_MAX_JOBS", DEFAULT_MAX_JOBS));
}

function clampOptions(options: BurnJobOptions = {}): Required<BurnJobOptions> {
  const iterations = Math.min(
    Math.max(
      1,
      options.iterations ?? envInt("VALKEY_CPU_BURN_ITERATIONS", DEFAULT_ITERATIONS),
    ),
    MAX_ITERATIONS,
  );
  const durationMs = Math.min(
    Math.max(
      1_000,
      options.durationMs ?? envInt("VALKEY_CPU_BURN_DURATION_MS", DEFAULT_DURATION_MS),
    ),
    MAX_DURATION_MS,
  );
  return { iterations, durationMs };
}

function summarizeJob(job: JobRecord): BurnJobSummary {
  return {
    id: job.id,
    startedAt: job.startedAt.toISOString(),
    endsAt: job.endsAt.toISOString(),
    durationMs: job.durationMs,
    iterations: job.iterations,
    evalsCompleted: job.evalsCompleted,
    lastError: job.lastError,
  };
}

export function getValkeyCpuBurnStatus(): ValkeyCpuBurnStatus {
  const active = [...jobs.values()].map(summarizeJob);
  return {
    configured: valkeyUrlConfigured(),
    activeJobs: active.length,
    maxJobs: maxJobs(),
    totalStarted,
    totalFinished,
    totalEvalsCompleted,
    // Cap listing so status stays usable under thousands of jobs.
    jobs: active.slice(0, 100),
  };
}

async function connectClient(): Promise<RedisClientType> {
  const url = resolveValkeyUrl();
  if (!url) {
    throw new Error(
      "VALKEY_URL (or REDIS_URL / DATABASE_URL) is not configured",
    );
  }

  const client = createClient({
    url,
    socket: {
      connectTimeout: 15_000,
      keepAlive: true,
      reconnectStrategy: false,
    },
  }) as RedisClientType;
  client.on("error", (err: Error) => {
    logger.error("valkey client error", { message: err.message });
  });
  await client.connect();
  return client;
}

async function closeClient(client: RedisClientType): Promise<void> {
  try {
    await client.quit();
  } catch {
    try {
      client.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function runJob(
  job: JobRecord,
  signal: AbortSignal,
): Promise<void> {
  let client: RedisClientType | undefined;
  try {
    client = await connectClient();
    let sha = (await client.scriptLoad(CPU_BURN_LUA)) as string;

    while (!signal.aborted) {
      try {
        await client.evalSha(sha, {
          arguments: [String(job.iterations)],
        });
        job.evalsCompleted += 1;
        totalEvalsCompleted += 1;
      } catch (err) {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        job.lastError = message;
        if (message.includes("NOSCRIPT")) {
          try {
            sha = (await client.scriptLoad(CPU_BURN_LUA)) as string;
            continue;
          } catch (reloadErr) {
            job.lastError =
              reloadErr instanceof Error ? reloadErr.message : "Unknown error";
            logger.error("valkey cpu burn script reload failed", {
              jobId: job.id,
              message: job.lastError,
            });
          }
        } else {
          logger.error("valkey cpu burn eval failed", {
            jobId: job.id,
            message,
          });
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    job.lastError = message;
    logger.error("valkey cpu burn job failed", { jobId: job.id, message });
  } finally {
    if (client) await closeClient(client);
  }
}

export type StartValkeyCpuBurnResult =
  | {
      ok: true;
      jobId: string;
      message: string;
      status: ValkeyCpuBurnStatus;
    }
  | {
      ok: false;
      error: string;
      message: string;
      status: ValkeyCpuBurnStatus;
    };

/**
 * Start one stackable 5-minute (default) burn job.
 * Safe to call concurrently — each request adds another job.
 */
export function startValkeyCpuBurn(
  options: BurnJobOptions = {},
): StartValkeyCpuBurnResult {
  const rawParams = { ...options };
  const clamped = clampOptions(options);

  logger.info("valkey cpu burn request", {
    params: rawParams,
    resolved: clamped,
    activeJobs: jobs.size,
    maxJobs: maxJobs(),
  });

  if (!valkeyUrlConfigured()) {
    logger.error("valkey cpu burn rejected", {
      error: "not_configured",
      params: rawParams,
    });
    return {
      ok: false,
      error: "not_configured",
      message: "VALKEY_URL (or REDIS_URL / DATABASE_URL) is not configured",
      status: getValkeyCpuBurnStatus(),
    };
  }

  if (jobs.size >= maxJobs()) {
    logger.error("valkey cpu burn rejected", {
      error: "max_jobs",
      params: rawParams,
      activeJobs: jobs.size,
      maxJobs: maxJobs(),
    });
    return {
      ok: false,
      error: "max_jobs",
      message: `Too many active burn jobs (max ${maxJobs()})`,
      status: getValkeyCpuBurnStatus(),
    };
  }

  jobSeq += 1;
  const id = `burn-${Date.now()}-${jobSeq}`;
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + clamped.durationMs);
  const abort = new AbortController();

  const job: JobRecord = {
    id,
    startedAt,
    endsAt,
    durationMs: clamped.durationMs,
    iterations: clamped.iterations,
    evalsCompleted: 0,
    lastError: null,
    abort,
    promise: Promise.resolve(),
  };

  const timer = setTimeout(() => {
    logger.info("valkey cpu burn job duration reached", {
      jobId: id,
      durationMs: clamped.durationMs,
      evalsCompleted: job.evalsCompleted,
    });
    abort.abort();
  }, clamped.durationMs);

  job.promise = runJob(job, abort.signal)
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      job.lastError = message;
      logger.error("valkey cpu burn job crashed", { jobId: id, message });
    })
    .finally(() => {
      clearTimeout(timer);
      jobs.delete(id);
      totalFinished += 1;
      logger.info("valkey cpu burn job stopped", {
        jobId: id,
        evalsCompleted: job.evalsCompleted,
        lastError: job.lastError,
        activeJobs: jobs.size,
      });
    });

  jobs.set(id, job);
  totalStarted += 1;

  logger.info("valkey cpu burn job started", {
    jobId: id,
    params: rawParams,
    resolved: clamped,
    endsAt: endsAt.toISOString(),
    activeJobs: jobs.size,
  });

  return {
    ok: true,
    jobId: id,
    message: `Burn job started for ${clamped.durationMs}ms (stacks with other jobs)`,
    status: getValkeyCpuBurnStatus(),
  };
}

export type StopValkeyCpuBurnResult = {
  ok: true;
  message: string;
  stopped: number;
  status: ValkeyCpuBurnStatus;
};

/** Abort every active burn job. */
export async function stopValkeyCpuBurn(): Promise<StopValkeyCpuBurnResult> {
  const active = [...jobs.values()];
  logger.info("valkey cpu burn stop-all request", {
    activeJobs: active.length,
  });

  for (const job of active) {
    job.abort.abort();
  }

  await Promise.all(active.map((j) => j.promise.catch(() => undefined)));

  return {
    ok: true,
    message: active.length === 0 ? "No burn jobs were running" : `Stopped ${active.length} burn job(s)`,
    stopped: active.length,
    status: getValkeyCpuBurnStatus(),
  };
}
