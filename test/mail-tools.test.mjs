import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { registerMailTools } from "../dist/tools/mail.js";

function createRecordingServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, config, callback) {
      tools.set(name, { config, callback });
    },
    tool() {
      throw new Error("mail tools should use registerTool so annotations and output schemas are available");
    },
  };
}

test("registerMailTools exposes annotated structured mail_query", async () => {
  const server = createRecordingServer();
  const mail = {
    supportsMailboxes: true,
    supportsBulkMailActions: false,
    supportsSpamControls: false,
    supportsMailboxFilters: false,
    async listMailboxes() {
      return [];
    },
    async listFolders() {
      return [];
    },
    async listMessages() {
      return { messages: [], total: 0 };
    },
    async readMessage() {
      throw new Error("not used");
    },
    async downloadAttachment() {
      throw new Error("not used");
    },
    async searchMessages() {
      return [];
    },
    async queryMessages() {
      return {
        mailboxUuid: "mailbox-1",
        folderId: "inbox-id",
        folderPath: "Inbox",
        messages: [{ uid: "1", subject: "Hello", from: "Ada <ada@example.com>", date: "2026-06-01T10:00:00Z", flags: [] }],
        total: 1,
        scannedCount: 1,
      };
    },
    async sendMessage() {
      return { messageId: "sent" };
    },
    async moveMessage() {},
    async deleteMessage() {},
    async flagMessage() {},
  };

  registerMailTools(server, mail);

  const tool = server.tools.get("mail_query");
  assert.ok(tool);
  assert.equal(tool.config.annotations.readOnlyHint, true);
  assert.equal(tool.config.annotations.destructiveHint, false);
  assert.ok(tool.config.outputSchema);

  const result = await tool.callback({ folder: "Inbox", query: "hello", limit: 5 });
  assert.equal(result.structuredContent.mailboxUuid, "mailbox-1");
  assert.equal(result.structuredContent.messages[0].uid, "1");
});

test("mail_read_message defaults to metadata-only reads", async () => {
  const server = createRecordingServer();
  const calls = [];
  const mail = {
    async listFolders() {
      return [];
    },
    async listMessages() {
      return { messages: [], total: 0 };
    },
    async readMessage(folder, uid, mailboxUuid, options) {
      calls.push({ folder, uid, mailboxUuid, options });
      return {
        subject: "Hello",
        from: "Ada <ada@example.com>",
        to: ["user@example.com"],
        cc: [],
        date: "2026-06-01T10:00:00Z",
        messageId: "<hello@example.com>",
        text: "",
        html: "",
        attachments: [],
      };
    },
    async downloadAttachment() {
      throw new Error("not used");
    },
    async searchMessages() {
      return [];
    },
    async sendMessage() {
      return { messageId: "sent" };
    },
    async moveMessage() {},
    async deleteMessage() {},
    async flagMessage() {},
  };

  registerMailTools(server, mail);
  const result = await server.tools.get("mail_read_message").callback({
    folder: "Inbox",
    uid: "1",
    mailbox_uuid: "mailbox-1",
  });

  assert.equal(calls[0].options.includeBody, false);
  assert.equal(calls[0].options.includeThreadContext, false);
  assert.equal(result.structuredContent.subject, "Hello");
  assert.equal(result._meta?.["infomaniak/untrustedContent"]?.source, "mail");
});

test("mail_download_attachment saves attachments by default instead of returning inline base64", async () => {
  const server = createRecordingServer();
  const mail = {
    async listFolders() {
      return [];
    },
    async listMessages() {
      return { messages: [], total: 0 };
    },
    async readMessage() {
      throw new Error("not used");
    },
    async downloadAttachment() {
      return {
        filename: "note.txt",
        contentType: "text/plain",
        size: 5,
        contentBase64: Buffer.from("hello").toString("base64"),
      };
    },
    async searchMessages() {
      return [];
    },
    async sendMessage() {
      return { messageId: "sent" };
    },
    async moveMessage() {},
    async deleteMessage() {},
    async flagMessage() {},
  };

  registerMailTools(server, mail);
  const result = await server.tools.get("mail_download_attachment").callback({
    folder: "Inbox",
    uid: "1",
    attachment_index: 0,
  });

  const filePath = result.structuredContent.filePath;
  try {
    assert.equal(result.structuredContent.contentBase64, undefined);
    assert.equal(readFileSync(filePath, "utf8"), "hello");
    assert.equal(statSync(dirname(filePath)).mode & 0o777, 0o700);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.match(result.structuredContent.resourceUri, /^infomaniak-temp:\/\//);
    assert.ok(result.content.some((item) => item.type === "resource_link" && item.uri === result.structuredContent.resourceUri));
    assert.equal(existsSync(filePath), true);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("mail_send can require exact external-send confirmation", async () => {
  const server = createRecordingServer();
  const sent = [];
  const mail = {
    async listFolders() {
      return [];
    },
    async listMessages() {
      return { messages: [], total: 0 };
    },
    async readMessage() {
      throw new Error("not used");
    },
    async downloadAttachment() {
      throw new Error("not used");
    },
    async searchMessages() {
      return [];
    },
    async sendMessage(params) {
      sent.push(params);
      return { messageId: "sent-1" };
    },
    async moveMessage() {},
    async deleteMessage() {},
    async flagMessage() {},
  };

  registerMailTools(server, mail, { strictExternalSend: true });

  const unsafe = await server.tools.get("mail_send").callback({
    to: ["ada@example.com"],
    subject: "Hello",
    text: "Hi",
  });
  assert.equal(unsafe.isError, true);
  assert.match(unsafe.content[0].text, /SEND MAIL TO ada@example.com/);
  assert.equal(sent.length, 0);

  const confirmed = await server.tools.get("mail_send").callback({
    to: ["ada@example.com"],
    subject: "Hello",
    text: "Hi",
    confirmation: "SEND MAIL TO ada@example.com",
  });
  assert.equal(confirmed.isError, undefined);
  assert.equal(sent.length, 1);
});

test("mail draft and folder tools expose safe contracts", async () => {
  const server = createRecordingServer();
  const calls = [];
  const mail = {
    supportsDrafts: true,
    supportsFolderManagement: true,
    async listFolders() {
      return [];
    },
    async listMessages() {
      return { messages: [], total: 0 };
    },
    async readMessage() {
      throw new Error("not used");
    },
    async downloadAttachment() {
      throw new Error("not used");
    },
    async searchMessages() {
      return [];
    },
    async sendMessage() {
      return { messageId: "sent" };
    },
    async saveDraft(params) {
      calls.push(["saveDraft", params]);
      return { mailboxUuid: "mailbox-1", draftId: "draft-1", uid: "99" };
    },
    async createFolder(params) {
      calls.push(["createFolder", params]);
      return { id: "folder-1", name: params.name, path: params.name };
    },
    async renameFolder(params) {
      calls.push(["renameFolder", params]);
      return { id: "folder-2", name: params.newName, path: params.newName };
    },
    async deleteFolder(params) {
      calls.push(["deleteFolder", params]);
    },
    async moveMessage() {},
    async deleteMessage() {},
    async flagMessage() {},
  };

  registerMailTools(server, mail);

  assert.equal(server.tools.get("mail_save_draft").config.annotations.destructiveHint, false);
  assert.equal(server.tools.get("mail_create_folder").config.annotations.destructiveHint, false);
  assert.equal(server.tools.get("mail_rename_folder").config.annotations.destructiveHint, false);
  assert.equal(server.tools.get("mail_delete_folder").config.annotations.destructiveHint, true);

  const draft = await server.tools.get("mail_save_draft").callback({
    to: ["ada@example.com"],
    subject: "Draft",
    text: "Hello",
    mailbox_uuid: "mailbox-1",
  });
  assert.equal(draft.structuredContent.draftId, "draft-1");
  assert.deepEqual(calls[0], ["saveDraft", {
    to: ["ada@example.com"],
    subject: "Draft",
    text: "Hello",
    mailboxUuid: "mailbox-1",
  }]);

  await server.tools.get("mail_create_folder").callback({
    name: "Planning",
    parent_folder: "Projects",
    mailbox_uuid: "mailbox-1",
  });
  await server.tools.get("mail_rename_folder").callback({
    folder: "Planning",
    new_name: "Archive",
    mailbox_uuid: "mailbox-1",
  });

  const unsafeDelete = await server.tools.get("mail_delete_folder").callback({
    folder: "Archive",
    mailbox_uuid: "mailbox-1",
    confirmation: "wrong",
  });
  assert.equal(unsafeDelete.isError, true);
  assert.match(unsafeDelete.content[0].text, /DELETE MAIL FOLDER Archive/);

  const deleted = await server.tools.get("mail_delete_folder").callback({
    folder: "Archive",
    mailbox_uuid: "mailbox-1",
    confirmation: "DELETE MAIL FOLDER Archive",
  });
  assert.equal(deleted.isError, undefined);
  assert.deepEqual(calls.at(-1), ["deleteFolder", {
    folder: "Archive",
    mailboxUuid: "mailbox-1",
    confirmation: "DELETE MAIL FOLDER Archive",
  }]);
});

test("mail spam cleanup previews before blocking and marking messages", async () => {
  const server = createRecordingServer();
  const calls = [];
  const mail = {
    supportsSpamControls: true,
    async listFolders() {
      return [];
    },
    async listMessages() {
      return { messages: [], total: 0 };
    },
    async readMessage() {
      throw new Error("not used");
    },
    async downloadAttachment() {
      throw new Error("not used");
    },
    async searchMessages() {
      return [];
    },
    async sendMessage() {
      return { messageId: "sent" };
    },
    async moveMessage() {},
    async deleteMessage() {},
    async flagMessage() {},
    async findMessagesBySender(criteria) {
      calls.push(["findMessagesBySender", criteria]);
      return {
        mailboxUuid: "mailbox-1",
        mailboxEmail: "me@example.com",
        sender: "@spam.example",
        count: 2,
        truncated: false,
        scannedFolders: [{ id: "inbox", name: "INBOX", path: "INBOX", matchedCount: 2 }],
        messages: [
          { mailboxUuid: "mailbox-1", folderId: "inbox", folderName: "INBOX", folderPath: "INBOX", uid: "1", subject: "Spam one", from: "a@spam.example", date: "2026-06-08T08:00:00Z", flags: [] },
          { mailboxUuid: "mailbox-1", folderId: "inbox", folderName: "INBOX", folderPath: "INBOX", uid: "2", subject: "Spam two", from: "b@spam.example", date: "2026-06-08T08:05:00Z", flags: [] },
        ],
      };
    },
    async getSpamSettings() {
      calls.push(["getSpamSettings"]);
      return {
        mailboxUuid: "mailbox-1",
        mailboxEmail: "me@example.com",
        mailboxName: "me",
        hostingId: 123,
        hasMoveSpam: false,
        authorizedSenders: [],
        blockedSenders: [],
      };
    },
    async setSpamFilter(params) {
      calls.push(["setSpamFilter", params]);
      return {
        mailboxUuid: "mailbox-1",
        mailboxEmail: "me@example.com",
        mailboxName: "me",
        hostingId: 123,
        hasMoveSpam: true,
        authorizedSenders: [],
        blockedSenders: ["*@spam.example"],
      };
    },
    async blockSender(params) {
      calls.push(["blockSender", params]);
      return {
        mailboxUuid: "mailbox-1",
        mailboxEmail: "me@example.com",
        mailboxName: "me",
        hostingId: 123,
        hasMoveSpam: false,
        authorizedSenders: [],
        blockedSenders: ["*@spam.example"],
      };
    },
    async unblockSender() {
      throw new Error("not used");
    },
    async markMessagesAsSpam(params) {
      calls.push(["markMessagesAsSpam", params]);
      return { mailboxUuid: "mailbox-1", markedCount: params.uids.length, uids: params.uids.map(String) };
    },
  };

  registerMailTools(server, mail);

  const preview = await server.tools.get("mail_spam_cleanup_preview").callback({
    sender: "@spam.example",
    folders: ["INBOX"],
    mark_existing: true,
    enable_spam_filter: true,
  });

  assert.equal(preview.structuredContent.blockPattern, "*@spam.example");
  assert.equal(preview.structuredContent.confirmationPhrase, "BLOCK *@spam.example AND MARK 2 MESSAGES AS SPAM AND ENABLE SPAM FILTER");
  assert.match(preview.structuredContent.selectionToken, /^[a-f0-9]{64}$/);

  const stale = await server.tools.get("mail_spam_cleanup_confirm").callback({
    sender: "@spam.example",
    folders: ["INBOX"],
    mark_existing: true,
    enable_spam_filter: true,
    selection_token: "0".repeat(64),
    confirmation: preview.structuredContent.confirmationPhrase,
  });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /selection token no longer matches/);

  const confirmed = await server.tools.get("mail_spam_cleanup_confirm").callback({
    sender: "@spam.example",
    folders: ["INBOX"],
    mark_existing: true,
    enable_spam_filter: true,
    selection_token: preview.structuredContent.selectionToken,
    confirmation: preview.structuredContent.confirmationPhrase,
  });

  assert.equal(confirmed.isError, undefined);
  assert.equal(confirmed.structuredContent.blocked, true);
  assert.equal(confirmed.structuredContent.markedCount, 2);
  assert.deepEqual(confirmed.structuredContent.markedUids, ["1", "2"]);
  assert.deepEqual(calls.filter((call) => call[0] === "blockSender")[0][1], {
    sender: "*@spam.example",
    confirmation: "BLOCK *@spam.example",
    mailboxUuid: "mailbox-1",
  });
  assert.equal(calls.some((call) => call[0] === "setSpamFilter"), true);
  assert.equal(calls.some((call) => call[0] === "markMessagesAsSpam"), true);
});
