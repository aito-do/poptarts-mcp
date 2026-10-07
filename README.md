# poptarts-mcp

Public [Model Context Protocol](https://modelcontextprotocol.io/) server for DigitalOcean App Platform.

## Surfaces

| Surface | Behavior |
| --- | --- |
| MCP tool `get_droplet` | Proxies DigitalOcean droplets MCP **`droplet-get`** using `DO_API_TOKEN`, with chaos outcomes. |
| MCP tool `list_droplets` | Proxies **`droplet-list`**. Optional `page` / `perPage`. |
| MCP tool `get_random_poptart_flavor` | Random Pop-Tarts flavor with the **same** chaos outcomes. |
| MCP tools `start_valkey_cpu_burn` / `stop_valkey_cpu_burn` / `get_valkey_cpu_burn_status` | Background workers that `EVAL` a tight Lua loop on Valkey (server-side CPU burn). |
| `GET /droplet/:id` | Same as `get_droplet` (HTTP **500** on simulated failure). |
| `GET /droplets` | Same as `list_droplets` (`?page=&per_page=`). |
| `GET /flavor` | Same as `get_random_poptart_flavor`. |
| `GET /valkey/cpu-burn` | Burn status. |
| `POST /valkey/cpu-burn/start` | Start burn (`{ iterations?, concurrency?, maxDurationMs? }`). Auto-stops after `maxDurationMs` (default 60s). |
| `POST /valkey/cpu-burn/stop` | Stop burn. |

### Chaos outcomes

Each chaotic request independently picks one of (~25% each):

1. **error_4xx** — simulated client error (`400` / `401` / `403` / `404` / `429`)
2. **error_5xx** — simulated server error (`500` / `502` / `503`)
3. **delayed** — sleep ~10s, then succeed
4. **ok** — succeed immediately

Override with `CHAOS=error_4xx|error_5xx|error|delayed|ok|random` (`error` ≡ `error_5xx`).

### Logging + tracing

Tools emit structured JSON logs: **info** on success, **error** on chaotic failure or DO API errors.

Each tool log includes chosen `traceId` / `spanId` / `traceparent` / `traceSource` when present (no full header dump).

Trace preference order:

1. MCP `_meta.traceparent` / `_meta.tracestate` (MCP SDK `TRACEPARENT_META_KEY`)
2. HTTP `traceparent` / `tracestate`
3. Zipkin B3 `x-b3-traceid` / `x-b3-spanid`
## Local development

```bash
export DO_API_TOKEN=dop_v1_...
npm install
npm run dev
# MCP:      http://127.0.0.1:8080/mcp
# Droplet:  http://127.0.0.1:8080/droplet/123456789
# Droplets: http://127.0.0.1:8080/droplets
# Flavor:   http://127.0.0.1:8080/flavor
# Valkey:   curl -X POST http://127.0.0.1:8080/valkey/cpu-burn/start -H 'content-type: application/json' -d '{}'
# Health:   http://127.0.0.1:8080/health
```

Environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DO_API_TOKEN` | _(required for droplet)_ | DigitalOcean personal access token (Bearer) |
| `VALKEY_URL` | _(required for CPU burn)_ | Valkey URL (`rediss://…`). Also accepts `REDIS_URL` / `DATABASE_URL` |
| `VALKEY_CPU_BURN_ITERATIONS` | `2000000` | Lua loop iterations per `EVAL` |
| `VALKEY_CPU_BURN_CONCURRENCY` | `4` | Parallel `EVAL` workers |
| `VALKEY_CPU_BURN_MAX_DURATION_MS` | `60000` | Auto-stop after this many ms |
| `CHAOS` | `random` | Force `error_4xx`, `error_5xx`, `error`, `delayed`, `ok`, or `random` |
| `CHAOS_DELAY_MS` | `10000` | Sleep when outcome is `delayed` |
| `DROPLET_CHAOS` / `DROPLET_CHAOS_DELAY_MS` | — | Legacy aliases for `CHAOS` / `CHAOS_DELAY_MS` |
| `PORT` | `8080` | HTTP listen port |
| `ALLOWED_HOSTS` | _(unset)_ | Optional Host allowlist |

### Valkey CPU burn

`POST /valkey/cpu-burn/start` (or MCP `start_valkey_cpu_burn`) connects with `VALKEY_URL` and runs concurrent background workers that `EVAL` a busy Lua loop on the **Valkey server** — the intended way to spike managed Valkey CPU for Insights / alert testing. Call `stop` or wait for `maxDurationMs`.

## Deploy to DigitalOcean App Platform

1. Create the app from `aito-do/poptarts-mcp` (Dockerfile, port `8080`, health `/health`).
2. Set secret `DO_API_TOKEN` in App Platform env (encrypted).
3. Or: `doctl apps create --spec .do/app.yaml` then set the secret in the UI / `doctl`.

```bash
doctl apps create --spec .do/app.yaml
```

## Connect an MCP client

```text
https://<your-app>.ondigitalocean.app/mcp
```

```json
{
  "mcpServers": {
    "poptarts": {
      "url": "https://<your-app>.ondigitalocean.app/mcp"
    }
  }
}
```

## License

MIT
