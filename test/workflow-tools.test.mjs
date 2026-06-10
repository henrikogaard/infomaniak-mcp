import test from "node:test";
import assert from "node:assert/strict";

import { registerWorkflowTools } from "../dist/tools/workflows.js";

function createRecordingServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, config, callback) {
      tools.set(name, { config, callback });
    },
  };
}

test("workflow tools aggregate read-only mail, meeting, cleanup, and kDrive context", async () => {
  const server = createRecordingServer();
  registerWorkflowTools(server, {
    mail: {
      async queryMessages() {
        return {
          mailboxUuid: "mailbox-1",
          folderId: "inbox",
          folderPath: "INBOX",
          messages: [
            { uid: "1", subject: "Invoice", from: "Ada <ada@example.com>", date: "2026-06-07T09:00:00Z", flags: [], hasAttachments: true, preview: "Please review" },
            { uid: "2", subject: "Lunch", from: "Grace <grace@example.com>", date: "2026-06-06T09:00:00Z", flags: ["\\Flagged"], preview: "Tomorrow?" },
          ],
          total: 2,
          scannedCount: 2,
        };
      },
      async findMessagesBySender() {
        return {
          mailboxUuid: "mailbox-1",
          mailboxEmail: "me@example.com",
          sender: "ada@example.com",
          count: 2,
          truncated: false,
          scannedFolders: [{ id: "inbox", name: "INBOX", path: "INBOX", matchedCount: 2 }],
          messages: [
            { mailboxUuid: "mailbox-1", folderId: "inbox", folderName: "INBOX", folderPath: "INBOX", uid: "1", subject: "Invoice", from: "ada@example.com", date: "2026-06-07T09:00:00Z", flags: [] },
          ],
        };
      },
    },
    calendar: {
      async listEvents() {
        return [{ id: "event-1", title: "Planning", start: "2026-06-08T09:00:00Z", end: "2026-06-08T10:00:00Z", attendees: [{ address: "ada@example.com" }] }];
      },
    },
    contacts: {
      async queryContacts({ query }) {
        return query === "ada@example.com"
          ? [{ url: "carddav://ada", displayName: "Ada", email: ["ada@example.com"] }]
          : [];
      },
    },
    kdrive: {
      async listRecents() {
        return [{ id: 1, name: "Plan.pdf", type: "file", size: 123 }];
      },
    },
  });

  for (const name of ["mail_triage_summary", "sender_cleanup_plan", "meeting_brief", "kdrive_recent_context"]) {
    const tool = server.tools.get(name);
    assert.ok(tool, `${name} registered`);
    assert.equal(tool.config.annotations.readOnlyHint, true);
  }

  const triage = await server.tools.get("mail_triage_summary").callback({ limit: 10 });
  assert.equal(triage.structuredContent.messages.length, 2);
  assert.deepEqual(triage.structuredContent.countsBySender, { "ada@example.com": 1, "grace@example.com": 1 });
  assert.equal(triage.structuredContent.attachmentCount, 1);

  const cleanup = await server.tools.get("sender_cleanup_plan").callback({ sender: "ada@example.com" });
  assert.equal(cleanup.structuredContent.nextPreviewTool, "mail_bulk_delete_preview");
  assert.equal(cleanup.structuredContent.count, 2);

  const brief = await server.tools.get("meeting_brief").callback({ days: 3 });
  assert.equal(brief.structuredContent.events.length, 1);
  assert.equal(brief.structuredContent.relatedContacts[0].displayName, "Ada");

  const recent = await server.tools.get("kdrive_recent_context").callback({ limit: 5 });
  assert.equal(recent.structuredContent.items.length, 1);
});
