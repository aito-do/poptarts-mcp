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

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${requireToken()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "poptarts-mcp/1.0",
  };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function doGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: authHeaders(),
  });
  const body = await parseBody(res);
  if (!res.ok) {
    throw new DoApiError(
      res.status,
      `DigitalOcean API error ${res.status}`,
      body,
    );
  }
  return body;
}

/**
 * Fetch a droplet by ID — same data the DigitalOcean droplets MCP
 * `droplet-get` tool returns (GET /v2/droplets/{id}).
 */
export async function getDroplet(id: number): Promise<unknown> {
  return doGet(`/droplets/${id}`);
}

export type ListDropletsParams = {
  page?: number;
  perPage?: number;
};

/**
 * List droplets — same data the DigitalOcean droplets MCP
 * `droplet-list` tool returns (GET /v2/droplets).
 */
export async function listDroplets(params: ListDropletsParams = {}): Promise<unknown> {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 50;
  const query = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  return doGet(`/droplets?${query.toString()}`);
}
