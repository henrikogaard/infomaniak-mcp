import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolResult } from "./tool-handler.js";

const REDACTED = "[redacted]";
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;

export type AuditRisk = "read" | "write" | "destructive" | "external_send";

export type AuditToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolAuditContext = {
  name: string;
  annotations?: AuditToolAnnotations;
  service?: string;
  action?: string;
};

export type AuditOutcome = "success" | "error";

export interface AuditToolCallOptions {
  context?: ToolAuditContext;
  args: unknown;
  outcome: AuditOutcome;
  durationMs: number;
  traceId?: string;
  result?: ToolResult;
  error?: unknown;
  extra?: unknown;
}

export function isAuditEnabled(): boolean {
  return parseBooleanEnv(process.env.INFOMANIAK_AUDIT) || Boolean(process.env.INFOMANIAK_AUDIT_LOG?.trim());
}

export function auditToolCall(options: AuditToolCallOptions): void {
  if (!isAuditEnabled() || !options.context?.name) return;

  const event = compactRecord({
    type: "tool_call",
    timestamp: new Date().toISOString(),
    traceId: options.traceId,
    toolName: options.context.name,
    service: options.context.service ?? inferService(options.context.name),
    action: options.context.action ?? options.context.name,
    risk: classifyAuditRisk(options.context.name, options.context.annotations),
    outcome: options.outcome,
    durationMs: Math.max(0, Math.round(options.durationMs)),
    sessionId: readExtraString(options.extra, "sessionId"),
    requestId: readExtraString(options.extra, "requestId"),
    arguments: redactAuditValue(options.args),
    resourceIds: extractResourceIds(options.args, options.result),
    error: options.error ? redactAuditText(errorMessage(options.error)) : undefined,
    pid: process.pid,
  });

  writeAuditEvent(event);
}

export function classifyAuditRisk(toolName: string, annotations: AuditToolAnnotations = {}): AuditRisk[] {
  if (annotations.readOnlyHint === true && annotations.destructiveHint !== true) {
    return ["read"];
  }

  const risk: AuditRisk[] = ["write"];
  if (annotations.destructiveHint === true) {
    risk.push("destructive");
  }
  if (isExternalSendTool(toolName)) {
    risk.push("external_send");
  }
  return risk;
}

export function redactAuditValue(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (shouldRedactKey(key)) return REDACTED;

  if (typeof value === "string") {
    if (isUrlKey(key)) return truncateString(redactUrlLike(value));
    if (isEmailKey(key) && looksLikeEmail(value)) return maskEmail(value);
    return truncateString(value);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactAuditValue(item, key, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_ARRAY_ITEMS} more omitted]`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redactAuditValue(childValue, childKey, seen);
  }
  return output;
}

export function redactAuditText(text: string): string {
  return text
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(token)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(password|secret|api[_-]?key)=\S+/gi, "$1=[redacted]");
}

function writeAuditEvent(event: Record<string, unknown>): void {
  const serialized = `${JSON.stringify(event)}\n`;
  const destination = process.env.INFOMANIAK_AUDIT_LOG?.trim();

  try {
    if (!destination || destination === "-" || destination.toLowerCase() === "stderr") {
      console.error(`[infomaniak-audit] ${serialized.trimEnd()}`);
      return;
    }

    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    appendFileSync(destination, serialized, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error(`[infomaniak-mcp] Warning: failed to write audit log: ${errorMessage(error)}`);
  }
}

function extractResourceIds(args: unknown, result: ToolResult | undefined): Record<string, unknown> | undefined {
  const resources: Record<string, unknown> = {};
  collectResourceIds(args, resources);
  collectResourceIds(result?.structuredContent, resources);
  return Object.keys(resources).length > 0 ? resources : undefined;
}

function collectResourceIds(value: unknown, output: Record<string, unknown>, key = "", seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null) {
    if (key && isResourceKey(key)) {
      output[key] = redactAuditValue(value, key);
    }
    return;
  }

  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    if (key && isResourceKey(key)) {
      output[key] = redactAuditValue(value, key);
      return;
    }
    for (const item of value) collectResourceIds(item, output, key, seen);
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    if (isResourceKey(childKey)) {
      output[childKey] = redactAuditValue(childValue, childKey);
    } else {
      collectResourceIds(childValue, output, childKey, seen);
    }
  }
}

function isResourceKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "id" ||
    normalized === "uid" ||
    normalized === "url" ||
    normalized === "uri" ||
    normalized === "folder" ||
    normalized === "destination" ||
    normalized.endsWith("id") ||
    normalized.endsWith("ids") ||
    normalized.endsWith("uid") ||
    normalized.endsWith("uuid") ||
    normalized.endsWith("url") ||
    normalized.endsWith("uri");
}

function shouldRedactKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "password" ||
    normalized === "passphrase" ||
    normalized === "secret" ||
    normalized === "token" ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "credential" ||
    normalized === "apikey" ||
    normalized === "privatekey" ||
    normalized === "recaptchatoken" ||
    normalized === "selectiontoken" ||
    normalized === "confirmation" ||
    normalized === "base64content" ||
    normalized === "contentbase64" ||
    normalized === "audiobase64" ||
    normalized === "content" ||
    normalized === "body" ||
    normalized === "html" ||
    normalized === "text" ||
    normalized === "message" ||
    normalized === "rawvcard" ||
    normalized.includes("password") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret");
}

function isUrlKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "url" ||
    normalized === "uri" ||
    normalized.endsWith("url") ||
    normalized.endsWith("uri") ||
    normalized.endsWith("link");
}

function isEmailKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "to" ||
    normalized === "cc" ||
    normalized === "bcc" ||
    normalized === "from" ||
    normalized === "sender" ||
    normalized === "recipient" ||
    normalized === "recipients" ||
    normalized === "attendees" ||
    normalized.endsWith("email");
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function inferService(toolName: string): string {
  const separator = toolName.indexOf("_");
  return separator > 0 ? toolName.slice(0, separator) : toolName;
}

function isExternalSendTool(toolName: string): boolean {
  return toolName === "mail_send" ||
    toolName === "kchat_post_message" ||
    toolName === "kchat_reply_thread" ||
    toolName === "kchat_send_direct_message" ||
    toolName === "swisstransfer_create" ||
    toolName === "kpaste_create" ||
    toolName === "chk_create_short_url" ||
    toolName === "kdrive_create_share_link" ||
    toolName === "kdrive_update_share_link" ||
    toolName === "kmeet_create_room";
}

function redactUrlLike(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@", 2);
  if (!local || !domain) return REDACTED;
  return `${local.slice(0, 1)}***@${domain}`;
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

function readExtraString(extra: unknown, key: "sessionId" | "requestId"): string | undefined {
  if (!extra || typeof extra !== "object") return undefined;
  const value = (extra as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
