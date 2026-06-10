import type { Config } from "../config.js";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

interface PasteResult {
  url: string;
  id: string;
}

interface PasteReadResult {
  id: string;
  content: string;
  burnAfterReading: boolean;
  passwordProtected: boolean;
  expiresAt?: string;
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

  async readPaste(params: {
    url: string;
    password?: string;
  }): Promise<PasteReadResult> {
    const parsed = parsePasteUrl(params.url, this.siteUrl);
    const res = await fetch(`${this.apiUrl}/${encodeURIComponent(parsed.id)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`kPaste ${res.status}: ${await res.text()}`);
    }

    const result = (await res.json()) as {
      result?: string;
      data?: {
        data?: string;
        vector?: string;
        salt?: string;
        burn?: boolean;
        password?: boolean;
        expirated_at?: number;
      };
      error?: unknown;
    };
    if (result.result && result.result !== "success") {
      throw new Error(`kPaste error: ${JSON.stringify(result)}`);
    }

    const paste = result.data;
    if (!paste?.data || !paste.vector || !paste.salt) {
      throw new Error(`kPaste response missing encrypted payload: ${JSON.stringify(result)}`);
    }
    if (paste.password && !params.password) {
      throw new Error("This kPaste is password-protected. Provide the password to decrypt it.");
    }

    return {
      id: parsed.id,
      content: await decryptPaste({
        encrypted: paste.data,
        key: parsed.key,
        vector: paste.vector,
        salt: paste.salt,
        password: params.password ?? "",
      }),
      burnAfterReading: paste.burn === true,
      passwordProtected: paste.password === true,
      expiresAt: paste.expirated_at ? new Date(paste.expirated_at * 1000).toISOString() : undefined,
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

function decodeBase58(value: string): Buffer {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid kPaste URL fragment: key is not base58.");
    }
    num = num * 58n + BigInt(index);
  }

  let hex = num.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let buffer = hex === "00" ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  for (const char of value) {
    if (char === "1") {
      buffer = Buffer.concat([Buffer.from([0]), buffer]);
    } else {
      break;
    }
  }
  return buffer;
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

async function decryptPaste(params: {
  encrypted: string;
  key: string;
  vector: string;
  salt: string;
  password: string;
}): Promise<string> {
  let keyMaterial = decodeBase58(params.key);
  if (keyMaterial.length < 32) {
    keyMaterial = Buffer.concat([Buffer.alloc(32 - keyMaterial.length), keyMaterial]);
  }
  if (params.password.length > 0) {
    keyMaterial = Buffer.concat([keyMaterial, binaryStringToBuffer(params.password)]);
  }

  const derivedKey = crypto.pbkdf2Sync(
    keyMaterial,
    Buffer.from(params.salt, "base64"),
    100000,
    32,
    "sha256"
  );

  const payload = Buffer.from(params.encrypted, "base64");
  if (payload.length < 17) {
    throw new Error("Encrypted kPaste payload is too short.");
  }
  const ciphertext = payload.subarray(0, -16);
  const authTag = payload.subarray(-16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, Buffer.from(params.vector, "base64"), {
    authTagLength: 16,
  });
  decipher.setAuthTag(authTag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decodeUtf8Binary((await inflate(compressed)).toString("latin1"));
}

function parsePasteUrl(value: string, siteUrl: string): { id: string; key: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("kPaste URL must be a full URL with a fragment decryption key.");
  }
  const expectedHost = new URL(siteUrl).host;
  if (parsed.host !== expectedHost) {
    throw new Error(`kPaste URL must use ${expectedHost}.`);
  }
  const id = parsed.pathname.split("/").filter(Boolean).pop();
  const key = parsed.hash.slice(1).split("&", 1)[0];
  if (!id) {
    throw new Error("kPaste URL is missing a paste ID.");
  }
  if (!key) {
    throw new Error("kPaste URL is missing the fragment decryption key.");
  }
  return { id, key };
}

function decodeUtf8Binary(value: string): string {
  return decodeURIComponent([...value]
    .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .join(""));
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
