# poptarts-mcp

Public [Model Context Protocol](https://modelcontextprotocol.io/) server that returns a random Pop-Tarts flavor over **Streamable HTTP**. Every other tool call sleeps for 30 seconds to simulate latency / long-lived requests.

Built to run on [DigitalOcean App Platform](https://docs.digitalocean.com/products/app-platform/).

## Tool

| Name | Behavior |
| --- | --- |
| `get_random_poptart_flavor` | Picks a random flavor. Odd calls respond immediately; even calls sleep ~30s first. |

Response payload:

```json
{
  "flavor": "Frosted Strawberry",
  "callNumber": 2,
  "delayed": true,
  "sleepMs": 30000
}
```

## Local development

```bash
npm install
npm run dev
# MCP: http://127.0.0.1:8080/mcp
# Health: http://127.0.0.1:8080/health
```

Optional env:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `POPTARTS_SLEEP_MS` | `30000` | Sleep on even tool calls |
| `ALLOWED_HOSTS` | _(unset)_ | Comma-separated Host allowlist (DNS rebinding protection). Leave unset on App Platform unless you want to lock the hostname. |

## Deploy to DigitalOcean App Platform

1. Push this repo (already public under `aito-do/poptarts-mcp`).
2. In the DigitalOcean control panel: **Apps → Create App → GitHub → aito-do/poptarts-mcp**.
3. Autodetect Dockerfile, HTTP port `8080`, health check `/health`.
4. Or apply the checked-in spec:

```bash
doctl apps create --spec .do/app.yaml
```

App Platform allows HTTP requests up to ~100s, so the 30s sleep fits within the platform limit.

## Connect an MCP client

Point a Streamable HTTP MCP client at:

```text
https://<your-app>.ondigitalocean.app/mcp
```

Example Cursor `mcp.json` shape (URL transport; exact field names depend on client):

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
