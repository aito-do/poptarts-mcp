# poptarts-mcp

Public [Model Context Protocol](https://modelcontextprotocol.io/) server for DigitalOcean App Platform.

## Surfaces

| Surface | Behavior |
| --- | --- |
| MCP tool `get_droplet` | Proxies DigitalOcean droplets MCP **`droplet-get`** using `DO_API_TOKEN`, with chaos outcomes. |
| MCP tool `list_droplets` | Proxies **`droplet-list`**. Optional `page` / `perPage`. |
| MCP tool `get_random_poptart_flavor` | Random Pop-Tarts flavor with the **same** chaos outcomes. |
| `GET /droplet/:id` | Same as `get_droplet` (HTTP **500** on simulated failure). |
| `GET /droplets` | Same as `list_droplets` (`?page=&per_page=`). |
| `GET /flavor` | Same as `get_random_poptart_flavor`. |

### Chaos outcomes

Each chaotic request independently picks one of:

1. **error** — simulated failure (`500` on HTTP; MCP `isError`)
2. **delayed** — sleep ~10s, then succeed
3. **ok** — succeed immediately

Override with `CHAOS=error|delayed|ok|random` (`DROPLET_CHAOS` still accepted).

### Logging + tracing

Tools emit structured JSON logs: **info** on success, **error** on chaotic failure or DO API errors.

If the caller sends OpenTelemetry / distributed-trace headers, `traceId` (and related fields) are included in the log body:

| Header | Source |
| --- | --- |
| `traceparent` / `tracestate` | W3C Trace Context (OTel default) |
| `x-b3-traceid` / `x-b3-spanid` | Zipkin B3 (fallback) |

Example log line:

```json
{
  "level": "info",
  "msg": "get_random_poptart_flavor succeeded",
  "time": "2026-09-10T03:50:00.000Z",
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "spanId": "b7ad6b7169203331",
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  "op": "get_random_poptart_flavor",
  "outcome": "ok",
  "delayMs": 0,
  "ok": true
}
```

## Local development

```bash
export DO_API_TOKEN=dop_v1_...
npm install
npm run dev
# MCP:      http://127.0.0.1:8080/mcp
# Droplet:  http://127.0.0.1:8080/droplet/123456789
# Droplets: http://127.0.0.1:8080/droplets
# Flavor:   http://127.0.0.1:8080/flavor
# Health:   http://127.0.0.1:8080/health
```

Environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DO_API_TOKEN` | _(required for droplet)_ | DigitalOcean personal access token (Bearer) |
| `CHAOS` | `random` | Force `error`, `delayed`, `ok`, or `random` |
| `CHAOS_DELAY_MS` | `10000` | Sleep when outcome is `delayed` |
| `DROPLET_CHAOS` / `DROPLET_CHAOS_DELAY_MS` | — | Legacy aliases for `CHAOS` / `CHAOS_DELAY_MS` |
| `PORT` | `8080` | HTTP listen port |
| `ALLOWED_HOSTS` | _(unset)_ | Optional Host allowlist |

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
