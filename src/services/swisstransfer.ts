import type { Config } from "../config.js";

interface TransferInit {
  container?: {
    UUID?: string;
    type?: string;
    [key: string]: unknown;
  };
  uploadHost?: string;
  filesUUID?: string[] | Record<string, string>;
  [key: string]: unknown;
}

interface TransferResult {
  linkUrl: string;
  containerUUID: string;
  completion?: unknown;
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
  private chunkSize = 50 * 1024 * 1024;

  constructor(_config: Config) {}

  async createTransfer(params: {
    files: Array<{ name: string; base64Content: string }>;
    message?: string;
    recipients?: string[];
    password?: string;
    expirationDays?: number;
    downloadLimit?: number;
    authorEmail?: string;
    recaptchaToken?: string;
    recaptchaVersion?: number;
  }): Promise<TransferResult> {
    if (!params.recaptchaToken) {
      throw new Error(
        "Swiss Transfer experimental upload requires a browser-generated reCAPTCHA token from swisstransfer.com. " +
        "Google documents that reCAPTCHA v3 tokens are generated client-side with execute() and expire after about two minutes."
      );
    }

    const files = params.files.map((file) => {
      const buffer = Buffer.from(file.base64Content, "base64");
      return {
        name: file.name,
        buffer,
        size: buffer.length,
        type: guessMimeType(file.name),
      };
    });

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    // Step 1: Initialize the transfer container
    const initBody: Record<string, unknown> = {
      duration: String(params.expirationDays ?? 30),
      authorEmail: params.authorEmail ?? "",
      message: params.message ?? "",
      sizeOfUpload: totalSize,
      numberOfDownload: params.downloadLimit ?? 250,
      numberOfFile: files.length,
      lang: "en",
      recipientsEmails: params.recipients ?? [],
      recaptcha: params.recaptchaToken,
      recaptchaVersion: params.recaptchaVersion ?? 3,
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
    };

    if (params.password) {
      initBody.password = params.password;
    }

    const initRes = await fetch(`${this.apiBase}/containers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initBody),
    });

    if (!initRes.ok) {
      const responseText = await initRes.text();
      if (initRes.status === 403 || initRes.status === 404) {
        throw new Error(
          "Swiss Transfer experimental upload was rejected by the live anti-abuse layer. " +
          "The live site uses /api/containers, /api/uploadChunk/*, and /api/uploadComplete, and container creation requires fields like recaptcha and recaptchaVersion. " +
          `Original response (${initRes.status}): ${responseText}`
        );
      }
      throw new Error(`Swiss Transfer container init failed (${initRes.status}): ${responseText}`);
    }

    const init = (await initRes.json()) as TransferInit;
    const containerUUID = init.container?.UUID;
    const uploadHost = normalizeUploadHost(init.uploadHost);

    if (!containerUUID || !uploadHost) {
      throw new Error(`Swiss Transfer container init returned an unexpected payload: ${JSON.stringify(init)}`);
    }

    const fileUUIDs = normalizeFileUUIDs(init.filesUUID, files.map((file) => file.name));

    // Step 2: Upload each file
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      const fileUUID = fileUUIDs[fileIndex];

      if (!fileUUID) {
        throw new Error(`No UUID returned for file "${file.name}"`);
      }

      const chunks = splitIntoChunks(file.buffer, this.chunkSize);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const isLastChunk = chunkIndex === chunks.length - 1 ? 1 : 0;
        const uploadUrl = `https://${uploadHost}/api/uploadChunk/${encodeURIComponent(containerUUID)}/${encodeURIComponent(fileUUID)}/${chunkIndex}/${isLastChunk}`;

        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(chunk),
        });

        if (!uploadRes.ok) {
          throw new Error(`Swiss Transfer upload failed for "${file.name}" chunk ${chunkIndex} (${uploadRes.status}): ${await uploadRes.text()}`);
        }
      }
    }

    // Step 3: Finalize
    const finalizeRes = await fetch(`${this.apiBase}/uploadComplete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        UUID: containerUUID,
        lang: "en",
        recipientsEmails: params.recipients ?? [],
      }),
    });

    if (!finalizeRes.ok) {
      throw new Error(`Swiss Transfer finalize failed (${finalizeRes.status}): ${await finalizeRes.text()}`);
    }

    const completion = (await finalizeRes.json()) as unknown;
    return {
      linkUrl: `https://www.swisstransfer.com/d/${containerUUID}`,
      containerUUID,
      uploadHost,
      completion,
    };
  }

  async getTransferInfo(transferId: string, password?: string): Promise<TransferInfo> {
    const headers: Record<string, string> = {};
    if (password) {
      headers.Authorization = Buffer.from(encodeURIComponent(password), "utf8").toString("base64");
    }

    const res = await fetch(`${this.apiBase}/links/${transferId}`, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`Swiss Transfer info ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as TransferInfo;
  }
}

function normalizeFileUUIDs(value: TransferInit["filesUUID"], names: string[]): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return names.map((name) => value[name]).filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function normalizeUploadHost(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Swiss Transfer container init did not include an upload host.");
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("@")) {
    throw new Error(`Unexpected Swiss Transfer upload host: ${value}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${trimmed}`);
  } catch {
    throw new Error(`Unexpected Swiss Transfer upload host: ${value}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) {
    throw new Error(`Unexpected Swiss Transfer upload host: ${value}`);
  }
  if (hostname !== "swisstransfer.com" && !hostname.endsWith(".swisstransfer.com")) {
    throw new Error(`Unexpected Swiss Transfer upload host: ${value}`);
  }
  return hostname;
}

function splitIntoChunks(buffer: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
  }
  return chunks;
}

function guessMimeType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "txt":
      return "text/plain";
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "zip":
      return "application/zip";
    case "csv":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}
