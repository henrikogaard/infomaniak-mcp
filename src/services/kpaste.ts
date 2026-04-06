import type { Config } from "../config.js";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const deflateRaw = promisify(zlib.deflateRaw);

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
  private baseUrl = "https://kpaste.infomaniak.com";

  constructor(_config: Config) {}

  async createPaste(params: {
    content: string;
    expiration?: "5min" | "1hour" | "1day" | "1week" | "1month";
    burnAfterReading?: boolean;
    password?: string;
  }): Promise<PasteResult> {
    // PrivateBin v2 encryption protocol

    // 1. Generate random master key (256 bits) and paste IV (12 bytes for GCM)
    const masterKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const salt = crypto.randomBytes(8);

    const iterations = 100000;
    const keySize = 256;
    const tagBits = 128;

    // 2. Derive AES key via PBKDF2
    // If password is set, it's concatenated with the master key
    const passphraseInput = params.password
      ? Buffer.concat([masterKey, Buffer.from(params.password, "utf8")])
      : masterKey;

    const derivedKey = crypto.pbkdf2Sync(passphraseInput, salt, iterations, keySize / 8, "sha256");

    // 3. Build the adata (additional authenticated data) array
    // Format: [[iv_b64, salt_b64, iterations, keysize, tagsize, algo, mode, compression], format, openDiscussion, burnAfterReading]
    const adata: unknown[] = [
      [
        iv.toString("base64"),
        salt.toString("base64"),
        iterations,
        keySize,
        tagBits,
        "aes",
        "gcm",
        "rawdeflate",
      ],
      "plaintext",
      0, // openDiscussion
      params.burnAfterReading ? 1 : 0,
    ];

    const adataJson = JSON.stringify(adata);

    // 4. Compress the content with raw deflate
    const pasteContent = JSON.stringify({ paste: params.content });
    const compressed = await deflateRaw(Buffer.from(pasteContent, "utf8"));

    // 5. Encrypt with AES-256-GCM, using adata as AAD
    const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, iv);
    cipher.setAAD(Buffer.from(adataJson, "utf8"));
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // 6. ct = base64(ciphertext + authTag)
    const ct = Buffer.concat([encrypted, authTag]).toString("base64");

    // 7. Map expiration
    const expirationMap: Record<string, string> = {
      "5min": "5min",
      "1hour": "1hour",
      "1day": "1day",
      "1week": "1week",
      "1month": "1month",
    };

    // 8. Build and send the request
    const body = {
      v: 2,
      adata,
      ct,
      meta: {
        expire: expirationMap[params.expiration ?? "1day"] ?? "1day",
      },
    };

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "JSONHttpRequest",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`kPaste ${res.status}: ${await res.text()}`);
    }

    const result = (await res.json()) as { id: string; url: string; status: number; deletetoken?: string };

    if (result.status !== 0) {
      throw new Error(`kPaste error: ${JSON.stringify(result)}`);
    }

    // 9. The master key goes in the URL fragment — server never sees it
    const keyBase58 = encodeBase58(masterKey);
    const pasteUrl = `${this.baseUrl}${result.url}#${keyBase58}`;

    return {
      url: pasteUrl,
      id: result.id,
    };
  }
}

/**
 * Base58 encoding (Bitcoin alphabet) for the encryption key in the URL fragment.
 */
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
