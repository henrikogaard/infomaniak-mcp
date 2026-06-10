import test from "node:test";
import assert from "node:assert/strict";

import { registerWorkflowPrompts } from "../dist/prompts/workflows.js";

function createRecordingServer() {
  const prompts = new Map();
  return {
    prompts,
    registerPrompt(name, config, callback) {
      prompts.set(name, { config, callback });
    },
    prompt(name) {
      throw new Error(`${name} should use registerPrompt`);
    },
  };
}

test("workflow prompts guide agents toward fast read-heavy mail and calendar paths", async () => {
  const server = createRecordingServer();
  registerWorkflowPrompts(server);

  for (const name of ["summarize_unread_mail", "prepare_meeting_brief", "organize_sender_cleanup"]) {
    assert.ok(server.prompts.get(name), `${name} registered`);
    assert.ok(server.prompts.get(name).config.description);
  }

  const unread = await server.prompts.get("summarize_unread_mail").callback({
    folder: "INBOX",
    limit: "25",
  });
  const unreadText = unread.messages.map((message) => message.content.text).join("\n");
  assert.match(unreadText, /mail_query/);
  assert.match(unreadText, /metadata/i);
  assert.doesNotMatch(unreadText, /mail_list_messages/);

  const meeting = await server.prompts.get("prepare_meeting_brief").callback({
    lookahead_days: "7",
  });
  const meetingText = meeting.messages.map((message) => message.content.text).join("\n");
  assert.match(meetingText, /calendar_list_events/);
  assert.match(meetingText, /contacts_search/);

  const cleanup = await server.prompts.get("organize_sender_cleanup").callback({
    sender: "newsletter@example.com",
  });
  const cleanupText = cleanup.messages.map((message) => message.content.text).join("\n");
  assert.match(cleanupText, /mail_find_by_sender/);
  assert.match(cleanupText, /mail_bulk_delete_preview/);
  assert.match(cleanupText, /mail_bulk_delete_confirm/);
});
