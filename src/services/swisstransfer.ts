import type { Config } from "../config.js";

interface TransferInit {
  containerUUID: string;
  uploadHost: string;
  filesUUID: Record<string, string>;
  [key: string]: unknown;
}

interface TransferResult {
  linkUrl: string;
  containerUUID: string;
  [key: string]: unknown;
}

interface TransferInfo {
  id: string;
  url: string;
  downloadUrl?: string;
  expiresAt?: string;
  files?: Array<{ name: string; size: number }>;
  [key: string]: unknown;
}

/**
 * Swiss Transfer — Encrypted file sharing up to 50GB.
 *
 * The upload flow is multi-step:
 * 1. POST to initialize the transfer container (returns container UUID + upload host)
 * 2. Upload each file to the upload host
 * 3. Finalize the transfer
 *
 * Note: The Swiss Transfer API is not publicly documented, so these endpoints
 * are based on observed behavior. They may change without notice.
 */
export class SwissTransferService {
  private apiBase = "https://www.swisstransfer.com/api";

  constructor(_config: Config) {}

  async createTransfer(params: {
    files: Array<{ name: string; base64Content: string }>;
    message?: string;
    recipients?: string[];
    password?: string;
    expirationDays?: number;
    downloadLimit?: number;
  }): Promise<TransferResult> {
    // Step 1: Initialize the transfer container
    const initBody: Record<string, unknown> = {
      duration: String(params.expirationDays ?? 30),
      authorEmail: "",
      message: params.message ?? "",
      numberOfDownload: params.downloadLimit ?? 250,
      language: "en",
      recipientsEmails: params.recipients ?? [],
      files: params.files.map((f) => ({
        name: f.name,
        size: Buffer.from(f.base64Content, "base64").length,
      })),
    };

    if (params.password) {
      initBody.password = params.password;
    }

    const initRes = await fetch(`${this.apiBase}/v1/upload/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initBody),
    });

    if (!initRes.ok) {
      throw new Error(`Swiss Transfer init failed (${initRes.status}): ${await initRes.text()}`);
    }

    const init = (await initRes.json()) as TransferInit;

    // Step 2: Upload each file
    for (const file of params.files) {
      const fileBuffer = Buffer.from(file.base64Content, "base64");
      const fileUUID = init.filesUUID?.[file.name];

      if (!fileUUID) {
        throw new Error(`No UUID returned for file "${file.name}"`);
      }

      const uploadUrl = `${init.uploadHost}/v1/upload/${init.containerUUID}/${fileUUID}`;

      const boundary = `----FormBoundary${Date.now()}`;
      const parts: Buffer[] = [];

      const header = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${file.name}"`,
        "Content-Type: application/octet-stream",
        "",
        "",
      ].join("\r\n");
      parts.push(Buffer.from(header));
      parts.push(fileBuffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!uploadRes.ok) {
        throw new Error(`Swiss Transfer upload failed for "${file.name}" (${uploadRes.status}): ${await uploadRes.text()}`);
      }
    }

    // Step 3: Finalize
    const finalizeRes = await fetch(`${this.apiBase}/v1/upload/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ containerUUID: init.containerUUID }),
    });

    if (!finalizeRes.ok) {
      throw new Error(`Swiss Transfer finalize failed (${finalizeRes.status}): ${await finalizeRes.text()}`);
    }

    const result = (await finalizeRes.json()) as TransferResult;
    return {
      ...result,
      linkUrl: result.linkUrl ?? `https://www.swisstransfer.com/d/${init.containerUUID}`,
      containerUUID: init.containerUUID,
    };
  }

  async getTransferInfo(transferId: string): Promise<TransferInfo> {
    const res = await fetch(`${this.apiBase}/v1/transfer/${transferId}`);
    if (!res.ok) {
      throw new Error(`Swiss Transfer info ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as TransferInfo;
  }
}
