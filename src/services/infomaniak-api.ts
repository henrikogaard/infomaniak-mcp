import type { Config } from "../config.js";

const BASE_URL = "https://api.infomaniak.com";

export class InfomaniakAPI {
  constructor(private config: Config) {}

  async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.config.infomaniakToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Infomaniak API ${res.status}: ${body}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    const query = params ? "?" + new URLSearchParams(params).toString() : "";
    return this.request(`${path}${query}`);
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async put(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<unknown> {
    return this.request(path, { method: "DELETE" });
  }

  async downloadRaw(path: string): Promise<Buffer> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.infomaniakToken}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Infomaniak download ${res.status}: ${await res.text()}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
