import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse {
  data?: unknown;
}

interface Transfer {
  id: string;
  url: string;
  downloadUrl?: string;
  expiresAt?: string;
  files?: Array<{ name: string; size: number }>;
  [key: string]: unknown;
}

export class SwissTransferService {
  private api: InfomaniakAPI;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
  }

  async createTransfer(params: {
    files: Array<{ name: string; base64Content: string }>;
    message?: string;
    recipients?: string[];
    password?: string;
    expirationDays?: number;
    downloadLimit?: number;
  }): Promise<Transfer> {
    // Swiss Transfer uses a multi-step upload process
    // Step 1: Initialize the transfer
    const initBody: Record<string, unknown> = {
      message: params.message ?? "",
      numberOfDownload: params.downloadLimit ?? 0,
      expirationDateValue: params.expirationDays ?? 30,
    };
    if (params.password) initBody.password = params.password;
    if (params.recipients) initBody.recipientsEmails = params.recipients;

    // Use the Swiss Transfer API
    const url = "https://www.swisstransfer.com/api/v1/upload";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...initBody,
        files: params.files.map((f) => ({
          name: f.name,
          size: Buffer.from(f.base64Content, "base64").length,
        })),
      }),
    });

    if (!res.ok) {
      throw new Error(`Swiss Transfer init ${res.status}: ${await res.text()}`);
    }

    const result = await res.json();
    return result as Transfer;
  }

  async getTransferInfo(transferId: string): Promise<Transfer> {
    const url = `https://www.swisstransfer.com/api/v1/transfer/${transferId}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Swiss Transfer info ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as Transfer;
  }
}
