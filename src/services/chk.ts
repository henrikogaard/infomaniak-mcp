import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse {
  data?: unknown;
}

interface RawShortUrl {
  code: string;
  url: string;
  created_at?: number | string | null;
  expiration_date?: number | string | null;
  [key: string]: unknown;
}

interface ShortUrl {
  id: string;
  short_url: string;
  long_url: string;
  clicks?: number;
  created_at?: string;
  expires_at?: string;
  qr_code_url?: string;
  [key: string]: unknown;
}

export class ChkService {
  private api: InfomaniakAPI;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
  }

  async createShortUrl(params: {
    url: string;
    customAlias?: string;
    expiresAt?: string;
  }): Promise<ShortUrl> {
    const body: Record<string, unknown> = {
      url: params.url,
    };
    if (params.customAlias) body.alias = params.customAlias;
    if (params.expiresAt) body.expiration_date = toEpochSeconds(params.expiresAt);

    const res = (await this.api.post("/1/url-shortener", body)) as RawShortUrl;
    return normalizeShortUrl(res);
  }

  async listShortUrls(): Promise<ShortUrl[]> {
    const res = (await this.api.get("/1/url-shortener")) as ApiResponse;
    return ((res.data ?? []) as RawShortUrl[]).map(normalizeShortUrl);
  }

  async deleteShortUrl(id: string): Promise<void> {
    try {
      await this.api.delete(`/1/url-shortener/${id}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("/1/url-shortener/")) {
        throw error;
      }
    }

    // The live Chk API currently advertises DELETE but may return 404 for valid codes.
    // Expiring the link in the past reliably disables it.
    await this.api.put(`/1/url-shortener/${id}`, {
      expiration_date: Math.floor(Date.now() / 1000) - 60,
    });
  }
}

function normalizeShortUrl(raw: RawShortUrl): ShortUrl {
  return {
    ...raw,
    id: raw.code,
    short_url: `https://chk.me/${raw.code}`,
    long_url: raw.url,
    created_at: normalizeTimestamp(raw.created_at),
    expires_at: normalizeTimestamp(raw.expiration_date),
  };
}

function normalizeTimestamp(value: number | string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }

  if (/^\d+$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toEpochSeconds(value: string): number | string {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : Math.floor(parsed.getTime() / 1000);
}
