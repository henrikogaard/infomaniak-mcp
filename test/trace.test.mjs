import test from "node:test";
import assert from "node:assert/strict";

import { safeHandler } from "../dist/tool-handler.js";
import { createTraceId, redactUrl, traceHttpRequest, traceToolCall } from "../dist/trace.js";

test("trace URL redaction keeps endpoint shape without query secrets", () => {
  assert.equal(
    redactUrl("https://api.infomaniak.com/2/profile?token=secret&cursor=abc"),
    "https://api.infomaniak.com/2/profile"
  );
  assert.equal(redactUrl("/1/mailbox/123/messages?search=ada"), "/1/mailbox/123/messages");
});

test("safeHandler emits opt-in tool traces with duration", async () => {
  const originalTrace = process.env.INFOMANIAK_TRACE;
  const originalError = console.error;
  const lines = [];
  process.env.INFOMANIAK_TRACE = "1";
  console.error = (line) => lines.push(String(line));

  try {
    const handler = safeHandler(async () => ({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { ok: true },
    }), "contacts_query");

    const result = await handler({});
    assert.equal(result.isError, undefined);
    assert.equal(
      lines.some((line) =>
        /\[infomaniak-trace\] trace_id=trc_[a-f0-9]{16} tool contacts_query ok duration_ms=\d+/.test(line)
      ),
      true
    );
  } finally {
    if (originalTrace === undefined) {
      delete process.env.INFOMANIAK_TRACE;
    } else {
      process.env.INFOMANIAK_TRACE = originalTrace;
    }
    console.error = originalError;
  }
});

test("trace output includes correlation IDs when supplied", () => {
  const originalTrace = process.env.INFOMANIAK_TRACE;
  const originalError = console.error;
  const lines = [];
  process.env.INFOMANIAK_TRACE = "1";
  console.error = (line) => lines.push(String(line));

  try {
    const traceId = createTraceId();
    traceToolCall("mail_query", 7, true, traceId);
    traceHttpRequest({
      traceId,
      method: "GET",
      url: "https://api.infomaniak.com/2/profile?token=secret",
      status: 200,
      attempts: 1,
      durationMs: 12,
    });

    assert.match(lines[0], /\[infomaniak-trace\] trace_id=trc_[a-f0-9]{16} tool mail_query ok duration_ms=7/);
    assert.match(lines[1], /\[infomaniak-trace\] trace_id=trc_[a-f0-9]{16} http GET https:\/\/api\.infomaniak\.com\/2\/profile status=200 attempts=1 duration_ms=12/);
  } finally {
    if (originalTrace === undefined) {
      delete process.env.INFOMANIAK_TRACE;
    } else {
      process.env.INFOMANIAK_TRACE = originalTrace;
    }
    console.error = originalError;
  }
});

test("HTTP trace emits redacted request metrics only when enabled", () => {
  const originalTrace = process.env.INFOMANIAK_TRACE;
  const originalError = console.error;
  const lines = [];
  process.env.INFOMANIAK_TRACE = "1";
  console.error = (line) => lines.push(String(line));

  try {
    traceHttpRequest({
      method: "GET",
      url: "https://api.infomaniak.com/2/profile?token=secret",
      status: 200,
      attempts: 1,
      durationMs: 12,
    });

    assert.deepEqual(lines, [
      "[infomaniak-trace] http GET https://api.infomaniak.com/2/profile status=200 attempts=1 duration_ms=12",
    ]);
  } finally {
    if (originalTrace === undefined) {
      delete process.env.INFOMANIAK_TRACE;
    } else {
      process.env.INFOMANIAK_TRACE = originalTrace;
    }
    console.error = originalError;
  }
});
