import test from "node:test";
import assert from "node:assert/strict";

import { ThrottledHttpClient } from "../dist/services/http-client.js";

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? "Too Many Requests" : "OK",
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("ThrottledHttpClient retries transient 429 responses with bounded concurrency", async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;

  const client = new ThrottledHttpClient({
    fetch: async (url) => {
      calls.push(String(url));
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (calls.length === 1) {
        return response(429, { error: "rate limited" }, { "retry-after": "0" });
      }
      return response(200, { ok: true });
    },
    maxConcurrent: 1,
    retries: 1,
    retryBaseDelayMs: 0,
    timeoutMs: 1000,
  });

  const [first, second] = await Promise.all([
    client.fetch("https://api.example.test/one"),
    client.fetch("https://api.example.test/two"),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(maxActive, 1);
});
