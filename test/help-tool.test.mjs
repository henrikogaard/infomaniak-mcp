import test from "node:test";
import assert from "node:assert/strict";

import { registerHelpTool } from "../dist/tools/help.js";

function createRecordingServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, config, callback) {
      tools.set(name, { config, callback });
    },
  };
}

test("infomaniak_help summarizes the currently advertised tools", async () => {
  const server = createRecordingServer();
  registerHelpTool(server, () => [
    {
      name: "mail_query",
      description: "Query message summaries",
      readOnly: true,
      destructive: false,
      inputKeys: ["folder", "limit", "mailbox_uuid"],
      hasOutputSchema: true,
    },
    {
      name: "mail_spam_cleanup_preview",
      description: "Preview spam cleanup",
      readOnly: true,
      destructive: false,
      inputKeys: ["sender", "mark_existing"],
      hasOutputSchema: true,
    },
    {
      name: "mail_spam_cleanup_confirm",
      description: "Confirm spam cleanup",
      readOnly: false,
      destructive: true,
      inputKeys: ["selection_token", "confirmation"],
      hasOutputSchema: true,
    },
    {
      name: "kdrive_list_files_page",
      description: "List one cursor-style page",
      readOnly: true,
      destructive: false,
      inputKeys: ["folder_id", "limit", "cursor"],
      hasOutputSchema: true,
    },
  ]);

  const tool = server.tools.get("infomaniak_help");
  assert.ok(tool);
  assert.equal(tool.config.annotations.readOnlyHint, true);
  assert.match(tool.config.description, /currently available Infomaniak MCP tools/);

  const result = await tool.callback({ include_tools: true });
  assert.equal(result.structuredContent.totalTools, 5);
  assert.equal(result.structuredContent.groups.find((group) => group.service === "mail").count, 3);
  assert.equal(result.structuredContent.groups.find((group) => group.service === "kdrive").count, 1);
  assert.ok(result.structuredContent.suggestedWorkflows.some((workflow) => workflow.name === "Block a spammer"));

  const mailQuery = result.structuredContent.groups.find((group) => group.service === "mail").tools.find((entry) => entry.name === "mail_query");
  assert.deepEqual(mailQuery.arguments, ["folder", "limit", "mailbox_uuid"]);
  assert.equal(mailQuery.risk, "read");
  assert.equal(mailQuery.hasOutputSchema, true);
  assert.match(mailQuery.useWhen, /Best default mail search/);
  assert.deepEqual(mailQuery.nextTools, []);

  const spamConfirm = result.structuredContent.groups.find((group) => group.service === "mail").tools.find((entry) => entry.name === "mail_spam_cleanup_confirm");
  assert.equal(spamConfirm.risk, "destructive");
  assert.match(spamConfirm.confirmation, /preview token/);
});

test("infomaniak_help can focus on one service and omit individual tool details", async () => {
  const server = createRecordingServer();
  registerHelpTool(server, () => [
    {
      name: "mail_query",
      description: "Query message summaries",
      readOnly: true,
      destructive: false,
      inputKeys: ["folder"],
      hasOutputSchema: true,
    },
    {
      name: "kdrive_search",
      description: "Search kDrive",
      readOnly: true,
      destructive: false,
      inputKeys: ["query"],
      hasOutputSchema: true,
    },
  ]);

  const result = await server.tools.get("infomaniak_help").callback({
    service: "mail",
    include_tools: false,
  });

  assert.deepEqual(result.structuredContent.groups.map((group) => group.service), ["mail"]);
  assert.equal(result.structuredContent.groups[0].tools, undefined);
});
