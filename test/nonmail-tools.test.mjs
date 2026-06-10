import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { registerCalendarTools } from "../dist/tools/calendar.js";
import { registerChkTools } from "../dist/tools/chk.js";
import { registerContactsTools } from "../dist/tools/contacts.js";
import { registerAITools } from "../dist/tools/ai.js";
import { registerKChatTools } from "../dist/tools/kchat.js";
import { registerKDriveTools } from "../dist/tools/kdrive.js";
import { registerKMeetTools } from "../dist/tools/kmeet.js";
import { registerKPasteTools } from "../dist/tools/kpaste.js";
import { registerSwissTransferTools } from "../dist/tools/swisstransfer.js";
import { registerTaskTools } from "../dist/tools/tasks.js";

function createRecordingServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, config, callback) {
      tools.set(name, { config, callback });
    },
    tool(name, description, inputSchema, annotationsOrCallback, maybeCallback) {
      tools.set(name, {
        legacy: true,
        config: {
          description,
          inputSchema,
          annotations: maybeCallback ? annotationsOrCallback : undefined,
        },
        callback: maybeCallback ?? annotationsOrCallback,
      });
    },
  };
}

function registerAllNonMailTools(server) {
  registerAITools(server, {
    async listModels() {},
    async chatCompletion() {
      return { choices: [{ message: { content: "hello" } }] };
    },
    async generateEmbeddings() {},
    async transcribeAudio() {},
  });

  registerCalendarTools(server, {
    async listCalendars() {},
    async listEvents() {},
    async createEvent() {},
    async updateEvent() {},
    async deleteEvent() {},
  });

  registerChkTools(server, {
    async createShortUrl() {},
    async listShortUrls() {},
    async deleteShortUrl() {},
  });

  registerContactsTools(server, {
    async listAddressBooks() {},
    async listContacts() {},
    async queryContacts() {},
    async getContact() {},
    async createContact() {},
    async updateContact() {},
    async deleteContact() {},
  });

  registerKChatTools(server, {
    async listChannels() {},
    async postMessage() {},
    async replyToThread() {},
    async addReaction() {},
    async getChannelHistory() {},
    async getThreadReplies() {},
    async getUsers() {},
    async getUserProfile() {},
    async sendDirectMessage() {},
  });

  registerKDriveTools(server, {
    async searchFiles() {},
    async listFiles() {},
    async getFileMetadata() {},
    async downloadFile() {},
    async uploadFile() {},
    async createFolder() {},
    async deleteFile() {},
    async moveFile() {},
    async renameFile() {},
    async getShareLink() {},
    async createShareLink() {},
    async updateShareLink() {},
    async deleteShareLink() {},
    async listShareLinks() {},
    async listVersions() {},
    async restoreVersion() {},
    async restoreVersionToDirectory() {},
    async listTrash() {},
    async restoreFromTrash() {},
    async listComments() {},
    async addComment() {},
    async replyToComment() {},
    async deleteComment() {},
    async listFileActivities() {},
    async listRecents() {},
  });

  registerKMeetTools(server, {
    createInstantRoom() {},
    async createScheduledRoom() {},
    async getRoomSettings() {},
  });

  registerKPasteTools(server, {
    async createPaste() {
      return { url: "https://kpaste.infomaniak.com/#secret", id: "paste-1" };
    },
  });

  registerSwissTransferTools(server, {
    async createTransfer() {},
    async getTransferInfo() {},
  });

  registerTaskTools(server, {
    async listCalendars() {},
    async listTasks() {},
    async getTask() {},
    async createTask() {},
    async updateTask() {},
    async setTaskCompleted() {},
    async deleteTask() {},
  });
}

test("all non-mail tools advertise annotations and output schemas", () => {
  const server = createRecordingServer();
  registerAllNonMailTools(server);

  for (const [name, tool] of server.tools) {
    assert.equal(tool.legacy, undefined, `${name} should use registerTool`);
    assert.ok(tool.config.description?.trim(), `${name} description`);
    assert.ok(tool.config.inputSchema, `${name} inputSchema`);
    assert.ok(tool.config.outputSchema, `${name} outputSchema`);
    assert.notEqual(tool.config.annotations?.readOnlyHint, undefined, `${name} readOnlyHint`);
    assert.notEqual(tool.config.annotations?.destructiveHint, undefined, `${name} destructiveHint`);
    assert.notEqual(tool.config.annotations?.openWorldHint, undefined, `${name} openWorldHint`);
  }
});

test("high-volume non-mail read tools advertise typed item schemas", () => {
  const server = createRecordingServer();
  registerAllNonMailTools(server);

  const arrayCases = [
    ["kdrive_list_files", { id: 1, name: "Budget.xlsx", type: "file" }, { name: "Budget.xlsx" }],
    ["kdrive_search", { id: 1, name: "Budget.xlsx", type: "file" }, { name: "Budget.xlsx" }],
    ["calendar_list_events", { id: "event-1", title: "Planning" }, { title: "Planning" }],
    ["contacts_query", { url: "carddav://contact", displayName: "Ada", email: ["ada@example.com"] }, { displayName: "Ada" }],
    ["contacts_search", { url: "carddav://contact", displayName: "Ada", email: ["ada@example.com"] }, { displayName: "Ada" }],
    ["tasks_list", { id: "task-1", title: "Follow up", status: "NEEDS-ACTION" }, { title: "Follow up" }],
    ["chk_list_short_urls", { id: "short-1", short_url: "https://chk.me/short-1", long_url: "https://example.com" }, { short_url: "https://chk.me/short-1" }],
  ];

  for (const [toolName, validItem, invalidItem] of arrayCases) {
    const schema = server.tools.get(toolName).config.outputSchema.data;
    assert.equal(schema.safeParse([validItem]).success, true, `${toolName} accepts expected item shape`);
    assert.equal(schema.safeParse([invalidItem]).success, false, `${toolName} rejects missing identity field`);
  }

  const kchatSchema = server.tools.get("kchat_get_channel_history").config.outputSchema;
  assert.equal(kchatSchema.safeParse({ posts: {}, order: ["post-1"] }).success, true);
  assert.equal(kchatSchema.safeParse({ posts: {} }).success, false);
});

test("read-heavy non-mail tools expose read-only annotations and output schemas", async () => {
  const server = createRecordingServer();

  registerKDriveTools(server, {
    async searchFiles() {
      return [{ id: 10, name: "budget.pdf", type: "file" }];
    },
    async listFiles() {
      return [
        { id: 1, name: "Documents", type: "dir" },
        { id: 2, name: "Budget.xlsx", type: "file" },
        { id: 3, name: "Plan.pdf", type: "file" },
      ];
    },
    async getFileMetadata() {
      return { id: 10, name: "budget.pdf", type: "file", size: 123 };
    },
    async downloadFile() {
      return Buffer.from("small").toString("base64");
    },
    async uploadFile() {},
    async createFolder() {},
    async deleteFile() {},
    async moveFile() {},
    async renameFile() {},
    async getShareLink() {},
    async createShareLink() {},
    async updateShareLink() {},
    async deleteShareLink() {},
    async listShareLinks() {},
    async listVersions() {},
    async restoreVersion() {},
    async restoreVersionToDirectory() {},
    async listTrash() {},
    async restoreFromTrash() {},
    async listComments() {},
    async addComment() {},
    async replyToComment() {},
    async deleteComment() {},
    async listFileActivities() {
      return [{ action: "file_update" }];
    },
    async listRecents() {
      return [{ id: 11, name: "recent.txt", type: "file" }];
    },
  });

  registerCalendarTools(server, {
    async listCalendars() {
      return [{ id: "cal-1", title: "Personal" }];
    },
    async listEvents() {
      return [{ id: "event-1", title: "Planning" }];
    },
    async createEvent() {},
    async updateEvent() {},
    async deleteEvent() {},
  });

  registerContactsTools(server, {
    async listAddressBooks() {
      return [{ url: "carddav://book", displayName: "Contacts" }];
    },
    async listContacts() {
      return [{ url: "carddav://contact", displayName: "Ada", email: ["ada@example.com"] }];
    },
    async queryContacts() {
      return [{ url: "carddav://contact", displayName: "Ada", email: ["ada@example.com"] }];
    },
    async getContact() {},
    async createContact() {},
    async updateContact() {},
    async deleteContact() {},
  });

  registerTaskTools(server, {
    async listCalendars() {
      return [{ url: "caldav://tasks", displayName: "Tasks" }];
    },
    async listTasks() {
      return [{ id: "task-1", title: "Follow up", status: "NEEDS-ACTION" }];
    },
    async getTask() {},
    async createTask() {},
    async updateTask() {},
    async setTaskCompleted() {},
    async deleteTask() {},
  });

  registerKChatTools(server, {
    async listChannels() {
      return [{ id: "channel-1", name: "town-square" }];
    },
    async postMessage() {},
    async replyToThread() {},
    async addReaction() {},
    async getChannelHistory() {
      return { posts: {}, order: [] };
    },
    async getThreadReplies() {},
    async getUsers() {
      return [{ id: "user-1", username: "ada" }];
    },
    async getUserProfile() {},
    async sendDirectMessage() {},
  });

  const readHeavyTools = [
    "kdrive_search",
    "kdrive_list_files",
    "kdrive_list_files_page",
    "kdrive_get_file",
    "kdrive_list_file_activities",
    "kdrive_list_recents",
    "calendar_list_calendars",
    "calendar_list_events",
    "contacts_list_address_books",
    "contacts_list",
    "contacts_query",
    "contacts_search",
    "tasks_list_calendars",
    "tasks_list",
    "tasks_search",
    "kchat_list_channels",
    "kchat_get_channel_history",
    "kchat_get_users",
  ];

  for (const name of readHeavyTools) {
    const tool = server.tools.get(name);
    assert.ok(tool, `${name} registered`);
    assert.equal(tool.config.annotations.readOnlyHint, true, `${name} readOnlyHint`);
    assert.equal(tool.config.annotations.destructiveHint, false, `${name} destructiveHint`);
    assert.ok(tool.config.outputSchema, `${name} outputSchema`);
  }

  const result = await server.tools.get("contacts_search").callback({ query: "ada" });
  assert.deepEqual(result.structuredContent.data[0].email, ["ada@example.com"]);

  const queryResult = await server.tools.get("contacts_query").callback({ query: "ada", limit: 10 });
  assert.deepEqual(queryResult.structuredContent.data[0].email, ["ada@example.com"]);
  const contactResult = await server.tools.get("contacts_get").callback({ contact_url: "carddav://contact" });
  assert.equal(contactResult._meta?.["infomaniak/untrustedContent"]?.source, "contacts");

  const pageResult = await server.tools.get("kdrive_list_files_page").callback({ folder_id: 1, limit: 2 });
  assert.equal(pageResult.structuredContent.items.length, 2);
  assert.equal(pageResult.structuredContent.nextCursor, "2");
});

test("page-oriented read tools return opaque cursors without changing legacy arrays", async () => {
  const server = createRecordingServer();

  registerKDriveTools(server, {
    async searchFiles() {},
    async listFiles() {
      return [
        { id: 1, name: "A", type: "file" },
        { id: 2, name: "B", type: "file" },
        { id: 3, name: "C", type: "file" },
      ];
    },
    async getFileMetadata() {},
    async downloadFile() {},
    async uploadFile() {},
    async createFolder() {},
    async deleteFile() {},
    async moveFile() {},
    async renameFile() {},
    async getShareLink() {},
    async createShareLink() {},
    async updateShareLink() {},
    async deleteShareLink() {},
    async listShareLinks() {},
    async listVersions() {},
    async restoreVersion() {},
    async restoreVersionToDirectory() {},
    async listTrash() {},
    async restoreFromTrash() {},
    async listComments() {},
    async addComment() {},
    async replyToComment() {},
    async deleteComment() {},
    async listFileActivities() {},
    async listRecents() {},
  });

  registerChkTools(server, {
    async createShortUrl() {},
    async listShortUrls() {
      return [
        { id: "a", short_url: "https://chk.me/a", long_url: "https://a.example" },
        { id: "b", short_url: "https://chk.me/b", long_url: "https://b.example" },
        { id: "c", short_url: "https://chk.me/c", long_url: "https://c.example" },
      ];
    },
    async deleteShortUrl() {},
  });

  const kdrive = await server.tools.get("kdrive_list_files_page").callback({ limit: 2 });
  assert.deepEqual(kdrive.structuredContent.items.map((item) => item.name), ["A", "B"]);
  assert.equal(kdrive.structuredContent.nextCursor, "2");

  const kdriveNext = await server.tools.get("kdrive_list_files_page").callback({ limit: 2, cursor: kdrive.structuredContent.nextCursor });
  assert.deepEqual(kdriveNext.structuredContent.items.map((item) => item.name), ["C"]);
  assert.equal(kdriveNext.structuredContent.nextCursor, undefined);

  const chk = await server.tools.get("chk_list_short_urls_page").callback({ limit: 2 });
  assert.deepEqual(chk.structuredContent.items.map((item) => item.id), ["a", "b"]);
  assert.equal(chk.structuredContent.nextCursor, "2");
});

test("kdrive_download_file saves large downloads and returns a resource link", async () => {
  const server = createRecordingServer();
  const content = Buffer.from("hello kdrive");

  registerKDriveTools(server, {
    async searchFiles() {},
    async listFiles() {},
    async getFileMetadata() {
      return { id: 42, name: "report.txt", type: "file", size: 2 * 1024 * 1024 };
    },
    async downloadFile() {
      return content.toString("base64");
    },
    async uploadFile() {},
    async createFolder() {},
    async deleteFile() {},
    async moveFile() {},
    async renameFile() {},
    async getShareLink() {},
    async createShareLink() {},
    async updateShareLink() {},
    async deleteShareLink() {},
    async listShareLinks() {},
    async listVersions() {},
    async restoreVersion() {},
    async restoreVersionToDirectory() {},
    async listTrash() {},
    async restoreFromTrash() {},
    async listComments() {},
    async addComment() {},
    async replyToComment() {},
    async deleteComment() {},
    async listFileActivities() {},
    async listRecents() {},
  });

  const result = await server.tools.get("kdrive_download_file").callback({ file_id: 42 });
  const filePath = result.structuredContent.filePath;

  try {
    assert.equal(result.structuredContent.contentBase64, undefined);
    assert.equal(result.structuredContent.name, "report.txt");
    assert.equal(readFileSync(filePath, "utf8"), "hello kdrive");
    assert.equal(statSync(dirname(filePath)).mode & 0o777, 0o700);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.equal(existsSync(filePath), true);
    assert.match(result.structuredContent.resourceUri, /^infomaniak-temp:\/\//);
    assert.ok(result.content.some((item) => item.type === "resource_link" && item.uri === result.structuredContent.resourceUri));
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("destructive non-mail tools require exact confirmation phrases", async () => {
  const server = createRecordingServer();
  const calls = [];

  registerKDriveTools(server, {
    async searchFiles() {},
    async listFiles() {},
    async getFileMetadata() {},
    async downloadFile() {},
    async uploadFile() {},
    async createFolder() {},
    async deleteFile(id) {
      calls.push(["kdrive_delete", id]);
    },
    async moveFile() {},
    async renameFile() {},
    async getShareLink() {},
    async createShareLink() {},
    async updateShareLink() {},
    async deleteShareLink(id) {
      calls.push(["kdrive_delete_share_link", id]);
    },
    async listShareLinks() {},
    async listVersions() {},
    async restoreVersion() {},
    async restoreVersionToDirectory() {},
    async listTrash() {},
    async restoreFromTrash() {},
    async listComments() {},
    async addComment() {},
    async replyToComment() {},
    async deleteComment(fileId, commentId) {
      calls.push(["kdrive_delete_comment", fileId, commentId]);
    },
    async listFileActivities() {},
    async listRecents() {},
  });

  registerCalendarTools(server, {
    async listCalendars() {},
    async listEvents() {},
    async createEvent() {},
    async updateEvent() {},
    async deleteEvent(id) {
      calls.push(["calendar_delete_event", id]);
    },
  });

  registerContactsTools(server, {
    async listAddressBooks() {},
    async listContacts() {},
    async getContact() {},
    async createContact() {},
    async updateContact() {},
    async deleteContact(url) {
      calls.push(["contacts_delete", url]);
    },
  });

  registerTaskTools(server, {
    async listCalendars() {},
    async listTasks() {},
    async getTask() {},
    async createTask() {},
    async updateTask() {},
    async setTaskCompleted() {},
    async deleteTask(id) {
      calls.push(["tasks_delete", id]);
    },
  });

  registerChkTools(server, {
    async createShortUrl() {},
    async listShortUrls() {},
    async deleteShortUrl(id) {
      calls.push(["chk_delete_short_url", id]);
    },
  });

  const cases = [
    ["kdrive_delete", { file_id: 42 }, { file_id: 42, confirmation: "MOVE 42 TO TRASH" }],
    ["kdrive_delete_share_link", { file_id: 42 }, { file_id: 42, confirmation: "DELETE SHARE LINK 42" }],
    ["kdrive_delete_comment", { file_id: 42, comment_id: 7 }, { file_id: 42, comment_id: 7, confirmation: "DELETE COMMENT 7 FROM FILE 42" }],
    ["calendar_delete_event", { event_id: "event-1" }, { event_id: "event-1", confirmation: "DELETE EVENT event-1" }],
    ["contacts_delete", { contact_url: "carddav://contact-1" }, { contact_url: "carddav://contact-1", confirmation: "DELETE CONTACT carddav://contact-1" }],
    ["tasks_delete", { task_id: "task-1" }, { task_id: "task-1", confirmation: "DELETE TASK task-1" }],
    ["chk_delete_short_url", { id: "short-1" }, { id: "short-1", confirmation: "DELETE SHORT URL short-1" }],
  ];

  for (const [toolName, unsafeArgs, confirmedArgs] of cases) {
    const unsafe = await server.tools.get(toolName).callback(unsafeArgs);
    assert.equal(unsafe.isError, true, `${toolName} rejects missing confirmation`);
    assert.match(unsafe.content[0].text, /confirmation/i);

    const confirmed = await server.tools.get(toolName).callback(confirmedArgs);
    assert.equal(confirmed.isError, undefined, `${toolName} accepts exact confirmation`);
  }

  assert.deepEqual(calls, [
    ["kdrive_delete", 42],
    ["kdrive_delete_share_link", 42],
    ["kdrive_delete_comment", 42, 7],
    ["calendar_delete_event", "event-1"],
    ["contacts_delete", "carddav://contact-1"],
    ["tasks_delete", "task-1"],
    ["chk_delete_short_url", "short-1"],
  ]);
});

test("kChat direct messages can require exact external-send confirmation", async () => {
  const server = createRecordingServer();
  const sent = [];

  registerKChatTools(server, {
    async listChannels() {},
    async postMessage() {},
    async replyToThread() {},
    async addReaction() {},
    async getChannelHistory() {},
    async getThreadReplies() {},
    async getUsers() {},
    async getUserProfile() {},
    async sendDirectMessage(username, text) {
      sent.push({ username, text });
      return { id: "post-1" };
    },
  }, { strictExternalSend: true });

  const unsafe = await server.tools.get("kchat_send_direct_message").callback({
    username: "ada",
    text: "hello",
  });
  assert.equal(unsafe.isError, true);
  assert.match(unsafe.content[0].text, /SEND KCHAT DM TO ada/);
  assert.equal(sent.length, 0);

  const confirmed = await server.tools.get("kchat_send_direct_message").callback({
    username: "ada",
    text: "hello",
    confirmation: "SEND KCHAT DM TO ada",
  });
  assert.equal(confirmed.isError, undefined);
  assert.equal(sent.length, 1);
});
