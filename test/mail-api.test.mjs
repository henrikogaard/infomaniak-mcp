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

test("HybridMailService prefers API for supported reads and falls back for attachment sends", async () => {
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
  assert.deepEqual(apiCalls, [["listMessages", "Inbox", 10, 1]]);
  assert.deepEqual(smtpCalls, [["sendMessage", 1]]);
  assert.deepEqual(sent, { messageId: "smtp-message" });
});
