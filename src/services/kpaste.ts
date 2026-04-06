import type { Config } from "../config.js";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const deflate = promisify(zlib.deflate);

interface PasteResult {
  url: string;
  id: string;
}

/**
 * kPaste — Encrypted ephemeral secret sharing.
 *
 * kPaste is based on PrivateBin v2 protocol.
 * - Content is zlib-compressed, then encrypted with AES-256-GCM.
 * - The AES key is derived via PBKDF2 from a random master key (+ optional password).
 * - The master key goes in the URL fragment (#) — never sent to the server.
 * - True zero-knowledge: the server cannot decrypt the content.
 *
 * Protocol reference: https://github.com/PrivateBin/PrivateBin/wiki/API
 */
export class KPasteService {
  private siteUrl = "https://kpaste.infomaniak.com";
  private apiUrl = "https://welcome.infomaniak.com/api/components/paste";

  constructor(_config: Config) {}

  async createPaste(params: {
    content: string;
    expiration?: "5min" | "1hour" | "1day" | "1week" | "1month";
    burnAfterReading?: boolean;
    password?: string;
  }): Promise<PasteResult> {
    const encrypted = await encryptPaste(params.content, params.password ?? "");
    const body = {
      data: encrypted.message,
      vector: encrypted.vector,
      salt: encrypted.salt,
      burn: params.burnAfterReading ?? false,
      validity: mapExpiration(params.expiration),
      password: Boolean(params.password),
    };

    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`kPaste ${res.status}: ${await res.text()}`);
    }

    const result = (await res.json()) as { result?: string; data?: string; error?: unknown };
    if (result.result !== "success" || !result.data) {
      throw new Error(`kPaste error: ${JSON.stringify(result)}`);
    }

    return {
      url: `${this.siteUrl}/${result.data}#${encrypted.key}`,
      id: result.data,
    };
  }
}

function encodeBase58(buffer: Buffer): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (buffer.length === 0) return "1";
  let num = BigInt("0x" + buffer.toString("hex"));
  const chars: string[] = [];
  while (num > 0n) {
    const remainder = num % 58n;
    chars.unshift(ALPHABET[Number(remainder)]);
    num = num / 58n;
  }
  // Preserve leading zeros
  for (const byte of buffer) {
    if (byte === 0) chars.unshift("1");
    else break;
  }
  return chars.join("") || "1";
}

function randomBinaryString(byteLength: number): string {
  return crypto.randomBytes(byteLength).toString("latin1");
}

function binaryStringToBuffer(value: string): Buffer {
  return Buffer.from(value, "latin1");
}

function utf16ToUtf8Binary(value: string): string {
  return unescape(encodeURIComponent(value));
}

async function encryptPaste(content: string, password: string): Promise<{
  key: string;
  vector: string;
  salt: string;
  message: string;
}> {
  const key = randomBinaryString(32);
  const vector = randomBinaryString(16);
  const salt = randomBinaryString(8);

  let keyMaterial = binaryStringToBuffer(key);
  if (password.length > 0) {
    keyMaterial = Buffer.concat([keyMaterial, binaryStringToBuffer(password)]);
  }

  const derivedKey = crypto.pbkdf2Sync(
    keyMaterial,
    binaryStringToBuffer(salt),
    100000,
    32,
    "sha256"
  );

  const compressed = await deflate(binaryStringToBuffer(utf16ToUtf8Binary(content)));
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, binaryStringToBuffer(vector), {
    authTagLength: 16,
  });
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);

  return {
    key: encodeBase58(binaryStringToBuffer(key)),
    vector: binaryStringToBuffer(vector).toString("base64"),
    salt: binaryStringToBuffer(salt).toString("base64"),
    message: encrypted.toString("base64"),
  };
}

function mapExpiration(expiration?: "5min" | "1hour" | "1day" | "1week" | "1month"): string {
  const mapping: Record<string, string> = {
    "5min": "5m",
    "1hour": "1h",
    "1day": "1d",
    "1week": "1w",
    "1month": "1m",
  };

  return mapping[expiration ?? "1day"] ?? "1d";
}
