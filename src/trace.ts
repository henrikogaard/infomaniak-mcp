import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HttpRequestMetrics } from "./services/http-client.js";

const traceStorage = new AsyncLocalStorage<string>();

export function isTraceEnabled(): boolean {
  const value = process.env.INFOMANIAK_TRACE ?? process.env.MCP_TRACE ?? "";
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function createTraceId(): string {
  return `trc_${randomBytes(8).toString("hex")}`;
}

export async function runWithTraceId<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return traceStorage.run(traceId, fn);
}

export function currentTraceId(): string | undefined {
  return traceStorage.getStore();
}

export function traceToolCall(name: string, durationMs: number, ok: boolean, traceId?: string): void {
  if (!isTraceEnabled()) return;
  const prefix = formatTracePrefix(traceId);
  console.error(`${prefix} tool ${name} ${ok ? "ok" : "error"} duration_ms=${Math.max(0, Math.round(durationMs))}`);
}

export function traceHttpRequest(metrics: HttpRequestMetrics): void {
  if (!isTraceEnabled()) return;
  const prefix = formatTracePrefix(metrics.traceId ?? currentTraceId());
  const parts = [
    prefix,
    "http",
    metrics.method,
    redactUrl(metrics.url),
    `status=${metrics.status ?? "unknown"}`,
    `attempts=${metrics.attempts}`,
    `duration_ms=${Math.max(0, Math.round(metrics.durationMs))}`,
  ];
  console.error(parts.join(" "));
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0] ?? value;
  }
}

function formatTracePrefix(traceId: string | undefined): string {
  return traceId ? `[infomaniak-trace] trace_id=${traceId}` : "[infomaniak-trace]";
}
