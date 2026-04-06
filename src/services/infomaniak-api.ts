import type { Config } from "../config.js";

const BASE_URL = "https://api.infomaniak.com";

export class InfomaniakAPI {
  constructor(private config: Config) {}

  async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${BASE_URL}${path}`;
    const method = options.method ?? "GET";

    // Only set Content-Type for methods with body
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.infomaniakToken}`,
    };
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> | undefined),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Infomaniak API ${method} ${path} → ${res.status}: ${body}`);
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

  async uploadRaw(path: string, body: Buffer, contentType: string): Promise<unknown> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.infomaniakToken}`,
        "Content-Type": contentType,
      },
      body: new Uint8Array(body),
    });
    if (!res.ok) {
      throw new Error(`Infomaniak upload ${res.status}: ${await res.text()}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }
}
