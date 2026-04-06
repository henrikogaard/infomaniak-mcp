import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse {
  data?: unknown;
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
    if (params.expiresAt) body.expires_at = params.expiresAt;

    const res = (await this.api.post("/1/url-shortener", body)) as ApiResponse;
    return res.data as ShortUrl;
  }

  async listShortUrls(): Promise<ShortUrl[]> {
    const res = (await this.api.get("/1/url-shortener")) as ApiResponse;
    return (res.data ?? []) as ShortUrl[];
  }

  async deleteShortUrl(id: string): Promise<void> {
    await this.api.delete(`/1/url-shortener/${id}`);
  }
}
