import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { safeHandler } from "../dist/tool-handler.js";
import { redactAuditValue, classifyAuditRisk } from "../dist/audit-log.js";

test("safeHandler writes sanitized audit events to JSONL file when enabled", async () => {
  const originalAudit = process.env.INFOMANIAK_AUDIT;
  const originalAuditLog = process.env.INFOMANIAK_AUDIT_LOG;
  const dir = await mkdtemp(join(tmpdir(), "infomaniak-audit-"));
  const logPath = join(dir, "audit.jsonl");
  process.env.INFOMANIAK_AUDIT = "1";
  process.env.INFOMANIAK_AUDIT_LOG = logPath;

  try {
    const handler = safeHandler(
      async () => ({
        content: [{ type: "text", text: "sent" }],
        structuredContent: { messageId: "msg-1" },
      }),
      {
        name: "mail_send",
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      }
    );

    const result = await handler({
      to: ["ada@example.com"],
      subject: "Launch notes",
      text: "Private body",
      attachments: [{ filename: "notes.txt", base64_content: "c2VjcmV0" }],
      confirmation: "SEND MAIL TO ada@example.com",
    }, { sessionId: "session-1", requestId: "req-1" });

    assert.equal(result.isError, undefined);

    const lines = (await readFile(logPath, "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);

    const event = JSON.parse(lines[0]);
    assert.equal(event.type, "tool_call");
    assert.equal(event.toolName, "mail_send");
    assert.equal(event.service, "mail");
    assert.deepEqual(event.risk, ["write", "external_send"]);
    assert.equal(event.outcome, "success");
    assert.equal(event.sessionId, "session-1");
    assert.equal(event.requestId, "req-1");
    assert.match(event.traceId, /^trc_[a-f0-9]{16}$/);
    assert.equal(event.arguments.subject, "Launch notes");
    assert.equal(event.arguments.text, "[redacted]");
    assert.equal(event.arguments.confirmation, "[redacted]");
    assert.equal(event.arguments.attachments[0].filename, "notes.txt");
    assert.equal(event.arguments.attachments[0].base64_content, "[redacted]");
    assert.equal(event.arguments.to[0], "a***@example.com");
    assert.equal(event.resourceIds.messageId, "msg-1");
  } finally {
    if (originalAudit === undefined) {
      delete process.env.INFOMANIAK_AUDIT;
    } else {
      process.env.INFOMANIAK_AUDIT = originalAudit;
    }
    if (originalAuditLog === undefined) {
      delete process.env.INFOMANIAK_AUDIT_LOG;
    } else {
      process.env.INFOMANIAK_AUDIT_LOG = originalAuditLog;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("safeHandler audits thrown errors without exposing secret input", async () => {
  const originalAudit = process.env.INFOMANIAK_AUDIT;
  const originalAuditLog = process.env.INFOMANIAK_AUDIT_LOG;
  const dir = await mkdtemp(join(tmpdir(), "infomaniak-audit-"));
  const logPath = join(dir, "audit.jsonl");
  process.env.INFOMANIAK_AUDIT = "1";
  process.env.INFOMANIAK_AUDIT_LOG = logPath;

  try {
    const handler = safeHandler(async () => {
      throw new Error("token abc123 failed");
    }, {
      name: "kpaste_create",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    });

    const result = await handler({ content: "secret paste body", expiration: "1day" });

    assert.equal(result.isError, true);

    const event = JSON.parse((await readFile(logPath, "utf8")).trim());
    assert.equal(event.outcome, "error");
    assert.deepEqual(event.risk, ["write", "external_send"]);
    assert.equal(event.arguments.content, "[redacted]");
    assert.equal(event.error, "token [redacted] failed");
  } finally {
    if (originalAudit === undefined) {
      delete process.env.INFOMANIAK_AUDIT;
    } else {
      process.env.INFOMANIAK_AUDIT = originalAudit;
    }
    if (originalAuditLog === undefined) {
      delete process.env.INFOMANIAK_AUDIT_LOG;
    } else {
      process.env.INFOMANIAK_AUDIT_LOG = originalAuditLog;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("audit helpers redact sensitive values and classify tool risk", () => {
  assert.equal(redactAuditValue("https://example.com/path?token=secret#key", "url"), "https://example.com/path");
  assert.equal(redactAuditValue("ada@example.com", "author_email"), "a***@example.com");
  assert.equal(redactAuditValue("Private body", "body"), "[redacted]");
  assert.deepEqual(
    classifyAuditRisk("calendar_delete_event", { readOnlyHint: false, destructiveHint: true }),
    ["write", "destructive"]
  );
  assert.deepEqual(
    classifyAuditRisk("calendar_list_events", { readOnlyHint: true, destructiveHint: false }),
    ["read"]
  );
});
