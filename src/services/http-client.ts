import { traceHttpRequest } from "../trace.js";

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export type HttpFetch = (url: string, init: RequestInit) => Promise<HttpResponse>;

export interface HttpRequestMetrics {
  url: string;
  method: string;
  status?: number;
  durationMs: number;
  attempts: number;
  traceId?: string;
}

export interface ThrottledHttpClientOptions {
  fetch?: HttpFetch;
  maxConcurrent?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  timeoutMs?: number;
  onRequestComplete?: (metrics: HttpRequestMetrics) => void;
}

interface QueueItem<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 30_000;

export class ThrottledHttpClient {
  private readonly fetchImpl: HttpFetch;
  private readonly maxConcurrent: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly onRequestComplete?: (metrics: HttpRequestMetrics) => void;
  private readonly queue: Array<QueueItem<unknown>> = [];
  private active = 0;

  constructor(options: ThrottledHttpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? (fetch as unknown as HttpFetch);
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT));
    this.retries = Math.max(0, Math.floor(options.retries ?? DEFAULT_RETRIES));
    this.retryBaseDelayMs = Math.max(0, Math.floor(options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS));
    this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    this.onRequestComplete = options.onRequestComplete;
  }

  fetch(url: string, init: RequestInit = {}): Promise<HttpResponse> {
    return this.enqueue(() => this.fetchWithRetry(url, init));
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve: resolve as (value: unknown) => void, reject });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.active += 1;
      item.run()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.active -= 1;
          this.drainQueue();
        });
    }
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<HttpResponse> {
    const startedAt = Date.now();
    const method = init.method ?? "GET";
    let attempts = 0;
    let lastStatus: number | undefined;

    try {
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        attempts = attempt + 1;
        const response = await this.fetchOnce(url, init);
        lastStatus = response.status;

        if (!isRetryableStatus(response.status) || attempt >= this.retries) {
          return response;
        }

        await delay(retryDelayMs(response, attempt, this.retryBaseDelayMs));
      }
    } finally {
      this.onRequestComplete?.({
        url,
        method,
        status: lastStatus,
        durationMs: Date.now() - startedAt,
        attempts,
      });
      traceHttpRequest({
        url,
        method,
        status: lastStatus,
        durationMs: Date.now() - startedAt,
        attempts,
      });
    }

    throw new Error("HTTP retry loop exited unexpectedly.");
  }

  private async fetchOnce(url: string, init: RequestInit): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: init.signal ?? controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response: HttpResponse, attempt: number, baseDelayMs: number): number {
  const retryAfter = response.headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const timestamp = Date.parse(retryAfter);
    if (!Number.isNaN(timestamp)) {
      return Math.max(0, timestamp - Date.now());
    }
  }
  return baseDelayMs * (2 ** attempt);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
