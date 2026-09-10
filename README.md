# poptarts-mcp

Public [Model Context Protocol](https://modelcontextprotocol.io/) server for DigitalOcean App Platform.

## Surfaces

| Surface | Behavior |
| --- | --- |
| MCP tool `get_droplet` | Proxies DigitalOcean droplets MCP **`droplet-get`** (DO API `GET /v2/droplets/{id}`) using `DO_API_TOKEN`. Randomly returns a simulated failure, a ~10s delayed payload, or the droplet info. |
| MCP tool `list_droplets` | Proxies **`droplet-list`** (`GET /v2/droplets`) with the same chaos outcomes. Optional `page` / `perPage`. |
| `GET /droplet/:id` | Same chaos + payload as `get_droplet` (HTTP **500** on simulated failure). |
| `GET /droplets` | Same chaos + payload as `list_droplets` (`?page=&per_page=`). |
| MCP tool `get_random_poptart_flavor` | Random Pop-Tarts flavor; odd calls fast, even calls sleep ~30s. |
| `GET /flavor` | Same as the Pop-Tarts tool. |

Droplet tools emit structured JSON logs: **info** on success, **error** on chaotic failure or DO API errors.

### Droplet chaos outcomes

Each droplet request independently picks one of:

1. **error** — simulated failure (`500` on HTTP; MCP `isError`)
2. **delayed** — sleep ~10s, then fetch the droplet
3. **ok** — fetch the droplet immediately

Override with `DROPLET_CHAOS=error|delayed|ok|random`.

Success payload shape:

```json
{
  "ok": true,
  "outcome": "delayed",
  "delayMs": 10000,
  "dropletId": 123456,
  "data": { "droplet": { "...": "..." } }
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
| `DROPLET_CHAOS` | `random` | Force `error`, `delayed`, `ok`, or `random` |
| `DROPLET_CHAOS_DELAY_MS` | `10000` | Sleep when outcome is `delayed` |
| `PORT` | `8080` | HTTP listen port |
| `POPTARTS_SLEEP_MS` | `30000` | Sleep on even Pop-Tarts requests |
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
