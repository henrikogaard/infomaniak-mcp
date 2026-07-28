import test from "node:test";
import assert from "node:assert/strict";

import { MailApiService } from "../dist/services/mail-api.js";
import { HybridMailService } from "../dist/services/mail-hybrid.js";

function jsonResponse(body, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function binaryResponse(bytes, headers = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? "";
      },
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
    async text() {
      return "";
    },
  };
}

test("MailApiService lists mailboxes with bearer-token API auth", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      result: "success",
      data: [
        {
          uuid: "mailbox-1",
          email: "user@example.com",
          mailbox: "user",
          is_primary: true,
          hosting_id: 123,
        },
      ],
    });
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const mailboxes = await mail.listMailboxes();

  assert.deepEqual(mailboxes, [
    {
      uuid: "mailbox-1",
      email: "user@example.com",
      mailbox: "user",
      isPrimary: true,
      hostingId: 123,
    },
  ]);
  assert.equal(calls[0].url, "https://mail.infomaniak.com/api/mailbox?with=aliases,permissions,accountId,count_users");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].options.headers.Accept, "application/json");
});

test("MailApiService coalesces concurrent mailbox discovery", async () => {
  const calls = [];
  let mailboxRequests = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      mailboxRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [{ id: "inbox-id", name: "Inbox", role: "inbox", children: [] }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  await Promise.all([mail.listFolders(), mail.listFolders()]);

  assert.equal(mailboxRequests, 1);
});

test("MailApiService maps folder paths to API folder ids when listing messages", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [
          {
            id: "inbox-id",
            name: "Inbox",
            separator: "/",
            role: "inbox",
            unread_count: 7,
            total_count: 42,
            children: [],
          },
        ],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=25&thread=on&severywhere=0&limit=25")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 100,
          threads: [
            {
              uid: "thread-1",
              subject: "API mail",
              from: [{ name: "Ada", email: "ada@example.com" }],
              date: "2026-05-10T10:00:00Z",
              messages_count: 2,
              unseen_messages: 1,
              messages: [{ uid: "555@inbox-id", preview: "Hello from the API" }],
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const result = await mail.listMessages("Inbox", 25, 2);

  assert.equal(result.total, 100);
  assert.deepEqual(result.messages, [
    {
      uid: "555",
      subject: "API mail",
      from: "Ada <ada@example.com>",
      date: "2026-05-10T10:00:00Z",
      flags: [],
      preview: "Hello from the API",
      threadUid: "thread-1",
      messagesCount: 2,
      unseenMessages: 1,
    },
  ]);
  assert.equal(calls.length, 3);
});

test("MailApiService caches folder resolution for repeated message reads", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [{ id: "inbox-id", name: "Inbox", role: "INBOX", children: [] }],
      });
    }
    if (url.includes("/mail/mailbox-1/folder/inbox-id/message?")) {
      return jsonResponse({ result: "success", data: { count: 0, threads: [] } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  await mail.listMessages("Inbox", 10, 1);
  await mail.listMessages("Inbox", 10, 2);

  const folderListCalls = calls.filter((call) => call.url.endsWith("/mail/mailbox-1/folder?with=ik-static"));
  assert.equal(folderListCalls.length, 1);
});

test("MailApiService accepts explicit API folder IDs without resolving folders", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=0&thread=on&severywhere=0&limit=10")) {
      return jsonResponse({ result: "success", data: { count: 0, threads: [] } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  await mail.listMessages("folder_id:inbox-id", 10, 1);

  assert.equal(calls.some((call) => call.url.endsWith("/mail/mailbox-1/folder?with=ik-static")), false);
});

test("MailApiService queries filtered message summaries with an opaque cursor", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [{ id: "inbox-id", name: "Inbox", role: "inbox", children: [] }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=0&thread=on&severywhere=0&limit=20")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 25,
          threads: [
            {
              uid: "thread-1",
              subject: "Build report",
              from: [{ name: "CI", email: "ci@example.com" }],
              date: "2026-06-01T10:00:00Z",
              seen: false,
              messages: [{ uid: "1@inbox-id", preview: "Slow test details", flags: [] }],
            },
            {
              uid: "thread-2",
              subject: "Lunch",
              from: [{ name: "Ada", email: "ada@example.com" }],
              date: "2026-06-01T09:00:00Z",
              seen: false,
              messages: [{ uid: "2@inbox-id", preview: "Cafe?", flags: [] }],
            },
          ],
        },
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=20&thread=on&severywhere=0&limit=20")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 25,
          threads: [{
            uid: "thread-3",
            subject: "Build report follow-up",
            from: [{ name: "CI", email: "ci@example.com" }],
            date: "2026-05-31T10:00:00Z",
            seen: false,
            messages: [{ uid: "3@inbox-id", preview: "Second page", flags: [] }],
          }],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const firstPage = await mail.queryMessages({ folder: "Inbox", query: "build", unread: true, limit: 1 });

  assert.equal(firstPage.messages.length, 1);
  assert.equal(firstPage.messages[0].uid, "1");
  assert.match(firstPage.nextCursor, /^[A-Za-z0-9_-]+$/);
  assert.equal(firstPage.scannedCount, 2);

  const secondPage = await mail.queryMessages({ cursor: firstPage.nextCursor });

  assert.equal(secondPage.messages.length, 1);
  assert.equal(secondPage.messages[0].uid, "3");
  assert.equal(secondPage.nextCursor, undefined);
});

test("MailApiService query cursors anchor pagination when new mail arrives", async () => {
  const calls = [];
  let messageListCalls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [{ id: "inbox-id", name: "Inbox", role: "inbox", children: [] }],
      });
    }
    if (url.includes("/mail/mailbox-1/folder/inbox-id/message?")) {
      messageListCalls += 1;
      assert.ok(url.includes("offset=0"));
      if (messageListCalls === 1) {
        return jsonResponse({
          result: "success",
          data: {
            count: 2,
            threads: [
              {
                uid: "thread-1",
                subject: "Build one",
                from: [{ name: "CI", email: "ci@example.com" }],
                date: "2026-06-02T10:00:00Z",
                messages: [{ uid: "1@inbox-id", preview: "Build result" }],
              },
              {
                uid: "thread-2",
                subject: "Build two",
                from: [{ name: "CI", email: "ci@example.com" }],
                date: "2026-06-01T10:00:00Z",
                messages: [{ uid: "2@inbox-id", preview: "Build result" }],
              },
            ],
          },
        });
      }
      return jsonResponse({
        result: "success",
        data: {
          count: 3,
          threads: [
            {
              uid: "thread-new",
              subject: "Build newest",
              from: [{ name: "CI", email: "ci@example.com" }],
              date: "2026-06-03T10:00:00Z",
              messages: [{ uid: "3@inbox-id", preview: "New arrival" }],
            },
            {
              uid: "thread-1",
              subject: "Build one",
              from: [{ name: "CI", email: "ci@example.com" }],
              date: "2026-06-02T10:00:00Z",
              messages: [{ uid: "1@inbox-id", preview: "Build result" }],
            },
            {
              uid: "thread-2",
              subject: "Build two",
              from: [{ name: "CI", email: "ci@example.com" }],
              date: "2026-06-01T10:00:00Z",
              messages: [{ uid: "2@inbox-id", preview: "Build result" }],
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const firstPage = await mail.queryMessages({ folder: "Inbox", query: "build", limit: 1 });
  const secondPage = await mail.queryMessages({ cursor: firstPage.nextCursor });

  assert.equal(firstPage.messages[0].uid, "1");
  assert.equal(secondPage.messages[0].uid, "2");
  assert.equal(secondPage.nextCursor, undefined);
});

test("MailApiService can read metadata without body or thread context", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [{ id: "inbox-id", name: "Inbox", role: "INBOX", children: [] }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message/555?prefered_format=plain&with=auto_uncrypt")) {
      return jsonResponse({
        result: "success",
        data: {
          uid: "555@inbox-id",
          msg_id: "<message@example.com>",
          subject: "Metadata only",
          from: [{ name: "Ada", email: "ada@example.com" }],
          to: [{ name: "Grace", email: "grace@example.com" }],
          body: "This should not be returned by default from the MCP tool",
          html: "<p>This should not be returned by default from the MCP tool</p>",
          headers: { secret: "omit" },
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const message = await mail.readMessage("Inbox", "555@inbox-id", "mailbox-1", {
    includeBody: false,
    includeHeaders: false,
    includeThreadContext: false,
    bodyFormat: "text",
  });

  assert.equal(message.subject, "Metadata only");
  assert.equal(message.text, "");
  assert.equal(message.html, "");
  assert.equal(message.headers, undefined);
  assert.ok(calls.some((call) => call.url.endsWith("prefered_format=plain&with=auto_uncrypt")));
});

test("HybridMailService searches through the Mail API before requiring IMAP fallback", async () => {
  const apiCalls = [];
  const api = {
    async searchMessages(folder, query, limit) {
      apiCalls.push(["searchMessages", folder, query, limit]);
      return [{ uid: "42", subject: "Invoice", from: "Ada <ada@example.com>", date: "2026-05-01T10:00:00Z" }];
    },
  };

  const mail = new HybridMailService({ api });
  const results = await mail.searchMessages("Inbox", "ada@example.com", 10);

  assert.deepEqual(apiCalls, [["searchMessages", "Inbox", "ada@example.com", 10]]);
  assert.deepEqual(results, [
    { uid: "42", subject: "Invoice", from: "Ada <ada@example.com>", date: "2026-05-01T10:00:00Z" },
  ]);
});

test("MailApiService moves deletes and flags explicit messages through Mail API actions", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [
          { id: "inbox-id", name: "Inbox", role: "inbox", children: [] },
          { id: "archive-id", name: "Archive", role: "archive", children: [] },
          { id: "trash-id", name: "Trash", role: "trash", children: [] },
        ],
      });
    }
    if (url.endsWith("/mail/mailbox-1/message/move")) {
      return jsonResponse({ result: "success", data: true });
    }
    if (url.endsWith("/mail/mailbox-1/message/seen")) {
      return jsonResponse({ result: "success", data: true });
    }
    if (url.endsWith("/mail/mailbox-1/message/star")) {
      return jsonResponse({ result: "success", data: true });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });

  await mail.moveMessage("Inbox", "42@inbox-id", "Archive", "mailbox-1");
  await mail.deleteMessage("Inbox", "43@inbox-id", "mailbox-1");
  await mail.flagMessage("Inbox", "44@inbox-id", ["\\Seen", "\\Flagged"], "add", "mailbox-1");

  const actionPayloads = calls
    .filter((call) => call.url.includes("/message/"))
    .map((call) => [call.url.split("/message/")[1], JSON.parse(call.options.body)]);

  assert.deepEqual(actionPayloads, [
    ["move", { uids: ["42"], to: "archive-id" }],
    ["move", { uids: ["43"], to: "trash-id" }],
    ["seen", { uids: ["44"] }],
    ["star", { uids: ["44"] }],
  ]);
});

test("MailApiService saves drafts without sending and manages folders", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{
          uuid: "mailbox-1",
          email: "user@example.com",
          mailbox: "user",
          is_primary: true,
        }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [
          { id: "parent-id", name: "Projects", role: "", children: [] },
          { id: "old-id", name: "Old", role: "", children: [] },
        ],
      });
    }
    if (url.endsWith("/mail/mailbox-1/draft") && options.method === "POST") {
      return jsonResponse({
        result: "success",
        data: { uuid: "draft-1", uid: "99@drafts-id" },
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder") && options.method === "POST") {
      return jsonResponse({
        result: "success",
        data: { id: "new-id", name: "Planning", role: "" },
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/old-id/rename") && options.method === "POST") {
      return jsonResponse({
        result: "success",
        data: { id: "old-id", name: "Archive 2026", role: "" },
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/old-id") && options.method === "DELETE") {
      return jsonResponse({ result: "success", data: true });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });

  const draft = await mail.saveDraft({
    to: ["ada@example.com"],
    cc: ["grace@example.com"],
    subject: "Draft subject",
    text: "Draft body",
    mailboxUuid: "mailbox-1",
  });
  const created = await mail.createFolder({ name: "Planning", parentFolder: "Projects", mailboxUuid: "mailbox-1" });
  const renamed = await mail.renameFolder({ folder: "Old", newName: "Archive 2026", mailboxUuid: "mailbox-1" });
  await mail.deleteFolder({ folder: "Old", confirmation: "DELETE MAIL FOLDER Old", mailboxUuid: "mailbox-1" });

  assert.deepEqual(draft, {
    mailboxUuid: "mailbox-1",
    draftId: "draft-1",
    uid: "99@drafts-id",
    resource: "/api/mail/mailbox-1/draft/draft-1",
  });
  assert.deepEqual(created, { id: "new-id", name: "Planning", path: "Planning" });
  assert.deepEqual(renamed, { id: "old-id", name: "Archive 2026", path: "Archive 2026" });

  const draftPayload = JSON.parse(calls.find((call) => call.url.endsWith("/mail/mailbox-1/draft")).options.body);
  assert.equal(draftPayload.action, "save");
  assert.equal(draftPayload.subject, "Draft subject");
  assert.deepEqual(draftPayload.to, [{ name: "", email: "ada@example.com" }]);
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith("/mail/mailbox-1/folder") && call.options.method === "POST").options.body), {
    name: "Planning",
    parent: "parent-id",
  });
});

test("MailApiService downloads attachments through the Mail API", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({ result: "success", data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }] });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({ result: "success", data: [{ id: "inbox-id", name: "INBOX", role: "INBOX", children: [] }] });
    }
    if (url.endsWith("/attachment/part-7")) {
      return binaryResponse([104, 101, 108, 108, 111], {
        "content-type": "text/plain",
        "content-length": "5",
        "content-disposition": 'attachment; filename="note.txt"',
      });
    }
    if (url.includes("/mail/mailbox-1/folder/inbox-id/message/42")) {
      return jsonResponse({
        result: "success",
        data: {
          uid: "42@inbox-id",
          attachments: [{ resource: "/api/mail/mailbox-1/folder/inbox-id/message/42@inbox-id/attachment/part-7", name: "note.txt", mime_type: "text/plain", size: 5 }],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const attachment = await mail.downloadAttachment("INBOX", "42@inbox-id", 0);

  assert.deepEqual(attachment, {
    id: "part-7",
    filename: "note.txt",
    contentType: "text/plain",
    size: 5,
    resource: "/api/mail/mailbox-1/folder/inbox-id/message/42@inbox-id/attachment/part-7",
    contentBase64: "aGVsbG8=",
  });
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer secret-token");
});

test("MailApiService uploads draft attachments before saving and sending", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", is_primary: true }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/draft") && options.method === "POST") {
      return jsonResponse({ result: "success", data: { uuid: "draft-1", uid: "99@drafts-id" } });
    }
    if (url.endsWith("/mail/mailbox-1/draft/attachment") && options.method === "POST") {
      return jsonResponse({ result: "success", data: { uuid: "attachment-1" } });
    }
    if (url.endsWith("/mail/mailbox-1/draft/draft-1") && options.method === "PUT") {
      return jsonResponse({ result: "success", data: { uid: "99@drafts-id" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const draft = await mail.saveDraft({
    mailboxUuid: "mailbox-1",
    to: ["ada@example.com"],
    subject: "Attached",
    text: "See file",
    attachments: [{ filename: "note.txt", base64Content: "SGVsbG8=", contentType: "text/plain" }],
  });

  assert.equal(draft.draftId, "draft-1");
  const upload = calls.find((call) => call.url.endsWith("/draft/attachment"));
  assert.equal(upload.options.headers["x-ws-attachment-filename"], "note.txt");
  assert.equal(upload.options.headers["x-ws-attachment-mime-type"], "text/plain");
  assert.deepEqual([...upload.options.body], [...Buffer.from("Hello")]);
  const update = calls.find((call) => call.url.endsWith("/draft/draft-1") && call.options.method === "PUT");
  assert.deepEqual(JSON.parse(update.options.body).attachments, ["attachment-1"]);
});

test("MailApiService scans all sender folders with bounded concurrency", async () => {
  let activeMessageFetches = 0;
  let maxActiveMessageFetches = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [
          { id: "inbox-id", name: "Inbox", role: "inbox", children: [] },
          { id: "archive-id", name: "Archive", role: "archive", children: [] },
          { id: "sent-id", name: "Sent", role: "sent", children: [] },
        ],
      });
    }
    if (url.includes("/message?offset=0&thread=on&severywhere=0&limit=10")) {
      activeMessageFetches += 1;
      maxActiveMessageFetches = Math.max(maxActiveMessageFetches, activeMessageFetches);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeMessageFetches -= 1;
      return jsonResponse({
        result: "success",
        data: {
          count: 1,
          threads: [{
            uid: "thread-1",
            subject: "Hello",
            from: [{ name: "Ada", email: "ada@example.com" }],
            date: "2026-05-01T10:00:00Z",
            messages: [{ uid: `1@${url.includes("archive-id") ? "archive-id" : url.includes("sent-id") ? "sent-id" : "inbox-id"}` }],
          }],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const result = await mail.findMessagesBySender({
    sender: "ada@example.com",
    allFolders: true,
    limitPerFolder: 10,
    maxResults: 10,
  });

  assert.equal(result.count, 3);
  assert.ok(maxActiveMessageFetches > 1);
  assert.ok(maxActiveMessageFetches <= 4);
});

test("MailApiService searches message summaries by sender without IMAP", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [{ id: "inbox-id", name: "Inbox", role: "INBOX", children: [] }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=0&thread=on&severywhere=0&limit=20")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 2,
          threads: [
            {
              uid: "thread-1",
              subject: "Newsletter",
              from: [{ name: "News", email: "news@example.com" }],
              date: "2026-05-01T09:00:00Z",
              messages: [{ uid: "1@inbox-id", preview: "Weekly update" }],
            },
            {
              uid: "thread-2",
              subject: "Invoice",
              from: [{ name: "Ada", email: "ada@example.com" }],
              date: "2026-05-01T10:00:00Z",
              messages: [{ uid: "2@inbox-id", preview: "May invoice" }],
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const results = await mail.searchMessages("Inbox", "ada@example.com", 10);

  assert.deepEqual(results, [
    { uid: "2", subject: "Invoice", from: "Ada <ada@example.com>", date: "2026-05-01T10:00:00Z" },
  ]);
});

test("MailApiService strips the folder suffix from message UIDs when reading", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [{ id: "inbox-id", name: "Inbox", role: "INBOX", children: [] }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message/555?prefered_format=html&with=auto_uncrypt,thread_context")) {
      return jsonResponse({
        result: "success",
        data: {
          uid: "555@inbox-id",
          msg_id: "<message@example.com>",
          subject: "Readable",
          from: [{ name: "Ada", email: "ada@example.com" }],
          to: [{ name: "Grace", email: "grace@example.com" }],
          body: "Plain text",
          html: "<p>Plain text</p>",
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const message = await mail.readMessage("Inbox", "555@inbox-id", "mailbox-1");

  assert.equal(message.subject, "Readable");
  assert.equal(message.messageId, "<message@example.com>");
  assert.ok(calls.some((call) => call.url.endsWith("/message/555?prefered_format=html&with=auto_uncrypt,thread_context")));
});

test("MailApiService sends plain mail through the draft API", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user" }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/draft") && options.method === "POST") {
      const payload = JSON.parse(options.body);
      assert.equal(payload.action, "save");
      assert.equal(payload.subject, "Hello");
      assert.equal(payload.to[0].email, "ada@example.com");
      return jsonResponse({ result: "success", data: { uuid: "draft-1", uid: 321 } });
    }
    if (url.endsWith("/mail/mailbox-1/draft/draft-1") && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      assert.equal(payload.action, "send");
      assert.equal(payload.uuid, "draft-1");
      return jsonResponse({ result: "success", data: { msg_id: "<sent@example.com>" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const result = await mail.sendMessage({
    to: ["ada@example.com"],
    subject: "Hello",
    text: "Line one\nLine two",
  });

  assert.deepEqual(result, { messageId: "<sent@example.com>" });
  assert.equal(calls.length, 3);
});

test("MailApiService finds messages from a sender across selected folders", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", hosting_id: 123 }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [
          { id: "inbox-id", name: "Inbox", role: "inbox", children: [] },
          { id: "archive-id", name: "Archive", role: "archive", children: [] },
          { id: "trash-id", name: "Trash", role: "trash", children: [] },
        ],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=0&thread=on&severywhere=0&limit=10")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 2,
          threads: [
            {
              uid: "thread-1",
              subject: "Invoice",
              from: [{ name: "Ada", email: "ada@example.com" }],
              date: "2026-05-01T10:00:00Z",
              messages: [{ uid: "1@inbox-id", preview: "May invoice" }],
            },
            {
              uid: "thread-2",
              subject: "Newsletter",
              from: [{ name: "News", email: "news@example.com" }],
              date: "2026-05-01T11:00:00Z",
              messages: [{ uid: "2@inbox-id", preview: "Weekly update" }],
            },
          ],
        },
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/archive-id/message?offset=0&thread=on&severywhere=0&limit=10")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 1,
          threads: [
            {
              uid: "thread-3",
              subject: "Receipt",
              from: [{ name: "Ada", email: "ada@example.com" }],
              date: "2026-04-01T10:00:00Z",
              messages: [{ uid: "3@archive-id", preview: "April receipt" }],
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const result = await mail.findMessagesBySender({
    sender: "ada@example.com",
    folders: ["Inbox", "Archive"],
    limitPerFolder: 10,
    maxResults: 10,
  });

  assert.equal(result.count, 2);
  assert.deepEqual(result.messages.map((message) => ({
    uid: message.uid,
    folderId: message.folderId,
    folderPath: message.folderPath,
    subject: message.subject,
  })), [
    { uid: "1", folderId: "inbox-id", folderPath: "Inbox", subject: "Invoice" },
    { uid: "3", folderId: "archive-id", folderPath: "Archive", subject: "Receipt" },
  ]);
  assert.equal(calls.some((call) => call.url.includes("/folder/trash-id/message?")), false);
});

test("MailApiService previews and confirms bulk delete by moving matching sender messages to Trash", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", hosting_id: 123 }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [
          { id: "inbox-id", name: "Inbox", role: "inbox", children: [] },
          { id: "trash-id", name: "Trash", role: "trash", children: [] },
        ],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=0&thread=on&severywhere=0&limit=20")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 2,
          threads: [
            {
              uid: "thread-1",
              subject: "Invoice",
              from: [{ name: "Ada", email: "ada@example.com" }],
              date: "2026-05-01T10:00:00Z",
              messages: [{ uid: "1@inbox-id", preview: "May invoice" }],
            },
            {
              uid: "thread-2",
              subject: "Receipt",
              from: [{ name: "Ada", email: "ada@example.com" }],
              date: "2026-05-02T10:00:00Z",
              messages: [{ uid: "2@inbox-id", preview: "May receipt" }],
            },
          ],
        },
      });
    }
    if (url.endsWith("/mail/mailbox-1/message/move")) {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload, { uids: ["1", "2"], to: "trash-id" });
      return jsonResponse({ result: "success", data: { undo_resource: "/undo/1" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const criteria = { sender: "ada@example.com", folders: ["Inbox"], limitPerFolder: 20, maxResults: 20 };
  const preview = await mail.previewBulkDeleteBySender(criteria);

  assert.equal(preview.count, 2);
  assert.equal(preview.action, "move_to_trash");
  assert.equal(preview.targetFolderId, "trash-id");
  assert.equal(preview.confirmationPhrase, "MOVE 2 MESSAGES FROM ada@example.com TO TRASH");
  assert.match(preview.selectionToken, /^[a-f0-9]{64}$/);

  const result = await mail.confirmBulkDeleteBySender({
    ...criteria,
    selectionToken: preview.selectionToken,
    confirmation: preview.confirmationPhrase,
  });

  assert.equal(result.movedCount, 2);
  assert.equal(result.targetFolderPath, "Trash");
  assert.deepEqual(result.uids, ["1", "2"]);
});

test("MailApiService rejects stale bulk delete confirmations", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", hosting_id: 123 }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder?with=ik-static")) {
      return jsonResponse({
        result: "success",
        data: [
          { id: "inbox-id", name: "Inbox", role: "inbox", children: [] },
          { id: "trash-id", name: "Trash", role: "trash", children: [] },
        ],
      });
    }
    if (url.endsWith("/mail/mailbox-1/folder/inbox-id/message?offset=0&thread=on&severywhere=0&limit=20")) {
      return jsonResponse({
        result: "success",
        data: {
          count: 1,
          threads: [{
            uid: "thread-1",
            subject: "Invoice",
            from: [{ name: "Ada", email: "ada@example.com" }],
            date: "2026-05-01T10:00:00Z",
            messages: [{ uid: "1@inbox-id", preview: "May invoice" }],
          }],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });

  await assert.rejects(
    () => mail.confirmBulkDeleteBySender({
      sender: "ada@example.com",
      folders: ["Inbox"],
      limitPerFolder: 20,
      maxResults: 20,
      selectionToken: "0".repeat(64),
      confirmation: "MOVE 1 MESSAGES FROM ada@example.com TO TRASH",
    }),
    /selection token no longer matches/
  );
});

test("MailApiService reads spam settings and blocks senders through the secured proxy", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", hosting_id: 123 }],
      });
    }
    if (url.endsWith("/securedProxy/1/mail_hostings/123/mailboxes/user?with=authorized_senders,blocked_senders,has_move_spam")) {
      return jsonResponse({
        result: "success",
        data: {
          authorized_senders: [{ email: "friend@example.com" }, { email: "spam@example.com" }],
          blocked_senders: [{ email: "old@example.com" }],
          has_move_spam: true,
        },
      });
    }
    if (url.endsWith("/securedProxy/1/mail_hostings/123/mailboxes/user") && options.method === "PATCH") {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload, {
        authorized_senders: ["friend@example.com"],
        blocked_senders: ["old@example.com", "spam@example.com"],
      });
      return jsonResponse({ result: "success", data: true });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const settings = await mail.blockSender({
    sender: "spam@example.com",
    confirmation: "BLOCK spam@example.com",
  });

  assert.equal(settings.hasMoveSpam, true);
  assert.deepEqual(settings.authorizedSenders, ["friend@example.com"]);
  assert.deepEqual(settings.blockedSenders, ["old@example.com", "spam@example.com"]);
});

test("MailApiService accepts domain shorthand for blocked senders", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", hosting_id: 123 }],
      });
    }
    if (url.endsWith("/securedProxy/1/mail_hostings/123/mailboxes/user?with=authorized_senders,blocked_senders,has_move_spam")) {
      return jsonResponse({
        result: "success",
        data: {
          authorized_senders: [],
          blocked_senders: [],
          has_move_spam: false,
        },
      });
    }
    if (url.endsWith("/securedProxy/1/mail_hostings/123/mailboxes/user") && options.method === "PATCH") {
      assert.deepEqual(JSON.parse(options.body), {
        authorized_senders: [],
        blocked_senders: ["*@spam.example"],
      });
      return jsonResponse({ result: "success", data: true });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const settings = await mail.blockSender({
    sender: "@spam.example",
    confirmation: "BLOCK *@spam.example",
  });

  assert.deepEqual(settings.blockedSenders, ["*@spam.example"]);
  assert.equal(calls.some((call) => call.options?.method === "PATCH"), true);
});

test("MailApiService marks explicit messages as spam with confirmation", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", hosting_id: 123 }],
      });
    }
    if (url.endsWith("/mail/mailbox-1/message/spam")) {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload, { uids: ["1", "2"] });
      return jsonResponse({ result: "success", data: { undo_resource: "/undo/spam" } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const result = await mail.markMessagesAsSpam({
    uids: ["1", "2"],
    confirmation: "MARK 2 MESSAGES AS SPAM",
  });

  assert.equal(result.markedCount, 2);
  assert.deepEqual(result.uids, ["1", "2"]);
});

test("MailApiService lists mailbox filters through the secured proxy", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/mailbox?with=aliases,permissions,accountId,count_users")) {
      return jsonResponse({
        result: "success",
        data: [{ uuid: "mailbox-1", email: "user@example.com", mailbox: "user", hosting_id: 123 }],
      });
    }
    if (url.endsWith("/securedProxy/1/mail_hostings/123/mailboxes/user/auth/filters")) {
      return jsonResponse({
        result: "success",
        data: {
          prevent_script: false,
          use_scripts: false,
          scripts: [],
          filters: [{
            name: "Move newsletters",
            is_enabled: true,
            has_all_of: true,
            conditions: [{ property: "from", operator: "contains", value: "@newsletter.example" }],
            actions: [{ type: "move", value: "Newsletters" }],
            template_id: null,
          }],
          templates: [],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const mail = new MailApiService({ token: "secret-token", fetch: fetchImpl });
  const filters = await mail.listMailboxFilters();

  assert.equal(filters.preventScript, false);
  assert.equal(filters.filters[0].name, "Move newsletters");
  assert.equal(filters.filters[0].conditions[0].property, "from");
});

test("HybridMailService prefers the Mail API for attachment sends when supported", async () => {
  const apiCalls = [];
  const smtpCalls = [];
  const api = {
    async listMessages(folder, limit, page) {
      apiCalls.push(["listMessages", folder, limit, page]);
      return { messages: [{ uid: 1, subject: "API", from: "", date: "", flags: [] }], total: 1 };
    },
    async sendMessage() {
      apiCalls.push(["sendMessage"]);
      return { messageId: "api-message" };
    },
  };
  const legacy = {
    async sendMessage(params) {
      smtpCalls.push(["sendMessage", params.attachments?.length ?? 0]);
      return { messageId: "smtp-message" };
    },
  };

  const mail = new HybridMailService({ api, legacy });
  const listed = await mail.listMessages("Inbox", 10, 1);
  const sent = await mail.sendMessage({
    to: ["ada@example.com"],
    subject: "With attachment",
    text: "Attached",
    attachments: [{ filename: "note.txt", base64Content: "SGVsbG8=" }],
  });

  assert.equal(listed.messages[0].subject, "API");
  assert.deepEqual(apiCalls, [["listMessages", "Inbox", 10, 1], ["sendMessage"]]);
  assert.deepEqual(smtpCalls, []);
  assert.deepEqual(sent, { messageId: "api-message" });
});
