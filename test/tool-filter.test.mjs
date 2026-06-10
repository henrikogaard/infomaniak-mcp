import test from "node:test";
import assert from "node:assert/strict";

import {
  createToolFilter,
  createToolFilteredServer,
  profileToFilterConfig,
  isServiceEnabled,
  shouldRegisterTool,
} from "../dist/tool-filter.js";

test("service allowlist limits enabled service groups", () => {
  const filter = createToolFilter({
    services: "mail,kdrive, kpaste",
    tools: "",
    disabledTools: "",
  });

  assert.equal(isServiceEnabled(filter, "mail"), true);
  assert.equal(isServiceEnabled(filter, "kdrive"), true);
  assert.equal(isServiceEnabled(filter, "kpaste"), true);
  assert.equal(isServiceEnabled(filter, "calendar"), false);
});

test("tool allowlist and denylist support exact names and star globs", () => {
  const filter = createToolFilter({
    services: "",
    tools: "mail_*,kdrive_search",
    disabledTools: "mail_delete,kchat_*",
  });

  assert.equal(shouldRegisterTool(filter, "mail_query"), true);
  assert.equal(shouldRegisterTool(filter, "kdrive_search"), true);
  assert.equal(shouldRegisterTool(filter, "calendar_list_events"), false);
  assert.equal(shouldRegisterTool(filter, "mail_delete"), false);
  assert.equal(shouldRegisterTool(filter, "kchat_get_users"), false);
});

test("read-only preset suppresses tools without read-only annotations", () => {
  const registered = [];
  const server = {
    registerTool(name, config, callback) {
      registered.push({ name, config, callback });
      return {
        name,
        enable() {},
        disable() {},
        remove() {},
        update() {},
      };
    },
  };
  const filter = createToolFilter({
    services: "",
    tools: "",
    disabledTools: "",
    readOnly: true,
  });
  const filteredServer = createToolFilteredServer(server, filter);

  filteredServer.registerTool("mail_query", {
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => {});
  filteredServer.registerTool("mail_send", {
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async () => {});
  filteredServer.registerTool("mail_delete", {
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async () => {});
  filteredServer.registerTool("unknown_risk", {}, async () => {});

  assert.deepEqual(registered.map((entry) => entry.name), ["mail_query"]);
});

test("tool registry captures descriptions, arguments, output schemas, and risk hints", () => {
  const registry = { tools: [] };
  const server = {
    registerTool(name, config, callback) {
      return {
        name,
        config,
        callback,
        enable() {},
        disable() {},
        remove() {},
        update() {},
      };
    },
  };
  const filter = createToolFilter({
    services: "",
    tools: "",
    disabledTools: "",
  });
  const filteredServer = createToolFilteredServer(server, filter, registry);

  filteredServer.registerTool("mail_query", {
    description: "Query mail",
    inputSchema: {
      limit: {},
      folder: {},
    },
    outputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => {});

  assert.deepEqual(registry.tools, [{
    name: "mail_query",
    description: "Query mail",
    readOnly: true,
    destructive: false,
    inputKeys: ["folder", "limit"],
    hasOutputSchema: true,
  }]);
});

test("tool profiles expand to service and tool filters", () => {
  assert.deepEqual(profileToFilterConfig("mail"), {
    services: "mail",
    tools: "",
    disabledTools: "",
    readOnly: false,
  });
  assert.deepEqual(profileToFilterConfig("safe-cleanup"), {
    services: "mail",
    tools: "mail_list_mailboxes,mail_list_folders,mail_query,mail_read_message,mail_find_by_sender,mail_bulk_delete_preview,mail_bulk_delete_confirm,mail_spam_settings,mail_spam_cleanup_preview,mail_spam_cleanup_confirm,mail_filters_list,sender_cleanup_plan,mail_triage_summary",
    disabledTools: "mail_send",
    readOnly: false,
  });
  assert.equal(profileToFilterConfig("unknown"), null);
});
