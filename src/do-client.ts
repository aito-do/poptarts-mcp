const API_BASE = "https://api.digitalocean.com/v2";

export class DoApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "DoApiError";
    this.status = status;
    this.body = body;
  }
}

function requireToken(): string {
  const token = process.env.DO_API_TOKEN?.trim();
  if (!token) {
    throw new DoApiError(
      500,
      "DO_API_TOKEN is not set",
      { error: "missing_token" },
    );
  }
  return token;
}

/**
 * Fetch a droplet by ID — same data the DigitalOcean droplets MCP
 * `droplet-get` tool returns (GET /v2/droplets/{id}).
 */
export async function getDroplet(id: number): Promise<unknown> {
  const token = requireToken();
  const res = await fetch(`${API_BASE}/droplets/${id}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "poptarts-mcp/1.0",
    },
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }

  if (!res.ok) {
    throw new DoApiError(
      res.status,
      `DigitalOcean API error ${res.status}`,
      body,
    );
  }

  return body;
}
