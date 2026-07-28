#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListPromptsResultSchema, ListResourceTemplatesResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(scriptDir, "..");
loadDotenv({ path: resolve(repoRoot, ".env"), override: false });

const codexServerName = process.env.SMOKE_CODEX_SERVER ?? "";
const codexConfig = codexServerName ? readCodexMcpConfig(codexServerName) : null;
const serverCommand = process.env.MCP_SERVER_COMMAND ?? codexConfig?.command ?? "node";
const serverArgs = process.env.MCP_SERVER_ARGS
  ? JSON.parse(process.env.MCP_SERVER_ARGS)
  : codexConfig?.args ?? [resolve(repoRoot, "dist/index.js")];

const smokeSelfEmail = process.env.SMOKE_SELF_EMAIL ?? "henrik@ogard.no";
const sendSelfEmail = ["1", "true", "yes", "on"].includes((process.env.SMOKE_SEND_SELF ?? "").toLowerCase());

const envKeys = [
  "INFOMANIAK_TOKEN",
  "MAIL_TOKEN",
  "KDRIVE_ID",
  "AI_PRODUCT_ID",
  "ENABLE_EXPERIMENTAL_SWISSTRANSFER",
  "MAIL_USER",
  "MAIL_PASSWORD",
  "DAV_USER",
  "DAV_PASSWORD",
  "IMAP_HOST",
  "IMAP_PORT",
  "SMTP_HOST",
  "SMTP_PORT",
  "CARDDAV_URL",
  "CALDAV_URL",
  "KCHAT_TOKEN",
  "KCHAT_TEAM_NAME",
  "INFOMANIAK_PROFILE",
  "INFOMANIAK_SERVICES",
  "INFOMANIAK_TOOLS",
  "INFOMANIAK_DISABLED_TOOLS",
  "INFOMANIAK_READONLY",
  "INFOMANIAK_READ_ONLY",
  "INFOMANIAK_DAV_CACHE_TTL_MS",
  "INFOMANIAK_TRACE",
  "STRICT_CONFIRM_EXTERNAL_SEND",
  "INFOMANIAK_STRICT_CONFIRM_EXTERNAL_SEND",
];

const serverEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...filterEnv(codexConfig?.env ?? {}),
  ...filterEnv(Object.fromEntries(envKeys.map((key) => [key, process.env[key] ?? ""]))),
};

const results = [];

function filterEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ""));
}

function parseTomlString(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("\"")) return trimmed;
  return JSON.parse(trimmed);
}

function parseTomlArray(value) {
  return JSON.parse(value.trim());
}

function readCodexMcpConfig(serverName) {
  const configPath = resolve(process.env.HOME ?? "", ".codex/config.toml");
  if (!existsSync(configPath)) {
    throw new Error(`Codex config not found at ${configPath}`);
  }

  const lines = readFileSync(configPath, "utf8").split(/\r?\n/);
  const serverHeader = `[mcp_servers.${serverName}]`;
  const envHeader = `[mcp_servers.${serverName}.env]`;
  const result = { command: null, args: null, env: {} };
  let section = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      section = trimmed;
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (section === serverHeader && key === "command") {
      result.command = parseTomlString(value);
    } else if (section === serverHeader && key === "args") {
      result.args = parseTomlArray(value);
    } else if (section === envHeader) {
      result.env[key] = parseTomlString(value);
    }
  }

  if (!result.command || !result.args) {
    throw new Error(`No complete [mcp_servers.${serverName}] block found in ${configPath}`);
  }

  return result;
}

function parseTextContent(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function parseJsonContent(result) {
  const text = parseTextContent(result);
  return JSON.parse(text);
}

function summarizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function runCheck(name, fn, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 30000;
  console.error(`[smoke:readonly] ${name}`);

  try {
    const details = await withTimeout(fn(), timeoutMs, name);
    results.push({
      name,
      status: "passed",
      durationMs: Date.now() - startedAt,
      details,
    });
    return details;
  } catch (error) {
    results.push({
      name,
      status: options.optional ? "skipped" : "failed",
      durationMs: Date.now() - startedAt,
      details: summarizeError(error),
    });
    return null;
  }
}

async function callTool(client, name, args = {}) {
  const result = await client.request(
    {
      method: "tools/call",
      params: { name, arguments: args },
    },
    CallToolResultSchema
  );

  if (result.isError) {
    throw new Error(parseTextContent(result) || `${name} returned isError`);
  }

  return result;
}

function hasTool(availableTools, name) {
  return availableTools.has(name);
}

function firstArrayItem(value) {
  return Array.isArray(value) ? value[0] ?? null : null;
}

function validateReadOnlyToolMetadata(toolsByName) {
  const readOnlyToolNames = [
    "infomaniak_help",
    "mail_list_mailboxes",
    "mail_list_folders",
    "mail_query",
    "mail_read_message",
    "mail_download_attachment",
    "mail_search",
    "mail_find_by_sender",
    "mail_spam_settings",
    "mail_spam_cleanup_preview",
    "mail_filters_list",
    "kdrive_search",
    "kdrive_list_files",
    "kdrive_list_files_page",
    "kdrive_get_file",
    "kdrive_download_file",
    "kdrive_list_file_activities",
    "kdrive_list_recents",
    "kdrive_recent_context",
    "calendar_list_calendars",
    "calendar_list_events",
    "meeting_brief",
    "contacts_list_address_books",
    "contacts_list",
    "contacts_query",
    "contacts_search",
    "contacts_get",
    "tasks_list_calendars",
    "tasks_list",
    "tasks_search",
    "tasks_get",
    "kchat_list_channels",
    "kchat_get_channel_history",
    "kchat_get_thread_replies",
    "kchat_get_users",
    "kchat_get_user_profile",
    "chk_list_short_urls",
    "chk_list_short_urls_page",
    "mail_triage_summary",
    "sender_cleanup_plan",
  ].filter((name) => toolsByName.has(name));

  const failures = [];
  for (const name of readOnlyToolNames) {
    const tool = toolsByName.get(name);
    if (tool.annotations?.readOnlyHint !== true) {
      failures.push(`${name}: missing readOnlyHint`);
    }
    if (tool.annotations?.destructiveHint === true) {
      failures.push(`${name}: destructiveHint should be false`);
    }
    if (!tool.outputSchema) {
      failures.push(`${name}: missing outputSchema`);
    }
  }

  const destructiveTools = [
    "mail_bulk_delete_confirm",
    "mail_mark_spam",
    "mail_spam_cleanup_confirm",
    "mail_delete_folder",
    "kdrive_delete",
    "kdrive_delete_share_link",
    "kdrive_delete_comment",
    "calendar_delete_event",
    "contacts_delete",
    "tasks_delete",
    "chk_delete_short_url",
    "kpaste_read",
  ].filter((name) => toolsByName.has(name));

  for (const name of destructiveTools) {
    const tool = toolsByName.get(name);
    if (tool.annotations?.destructiveHint !== true) {
      failures.push(`${name}: missing destructiveHint`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  return {
    checkedReadOnly: readOnlyToolNames.length,
    checkedDestructive: destructiveTools.length,
  };
}

async function main() {
  if (sendSelfEmail && smokeSelfEmail !== "henrik@ogard.no") {
    throw new Error("Refusing to send smoke email: SMOKE_SELF_EMAIL must be henrik@ogard.no");
  }

  const stderrChunks = [];
  const transport = new StdioClientTransport({
    command: serverCommand,
    args: serverArgs,
    env: serverEnv,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

  const client = new Client({
    name: "infomaniak-readonly-smoke",
    version: "1.1.0",
  });
  client.onerror = (error) => {
    stderrChunks.push(`\n[client-error] ${summarizeError(error)}`);
  };

  await client.connect(transport);

  try {
    const toolsResult = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
    const availableTools = new Set(toolsResult.tools.map((tool) => tool.name));
    const toolsByName = new Map(toolsResult.tools.map((tool) => [tool.name, tool]));

    await runCheck("tools/list", async () => ({
      count: toolsResult.tools.length,
      hasHelp: hasTool(availableTools, "infomaniak_help"),
      hasMailApi: hasTool(availableTools, "mail_list_mailboxes"),
      hasTasks: hasTool(availableTools, "tasks_list"),
      hasKDrive: hasTool(availableTools, "kdrive_list_files"),
      hasKChat: hasTool(availableTools, "kchat_list_channels"),
    }));

    await runCheck("tool_metadata", async () => validateReadOnlyToolMetadata(toolsByName));

    await runCheck("prompts/list", async () => {
      const promptsResult = await client.request({ method: "prompts/list", params: {} }, ListPromptsResultSchema);
      const promptNames = new Set(promptsResult.prompts.map((prompt) => prompt.name));
      const expected = ["summarize_unread_mail", "prepare_meeting_brief", "organize_sender_cleanup"];
      const missing = expected.filter((name) => !promptNames.has(name));
      if (missing.length > 0) {
        throw new Error(`Missing workflow prompts: ${missing.join(", ")}`);
      }
      return {
        count: promptsResult.prompts.length,
        workflowPrompts: expected.length,
      };
    });

    await runCheck("resources/templates/list", async () => {
      const resourcesResult = await client.request({ method: "resources/templates/list", params: {} }, ListResourceTemplatesResultSchema);
      const templateNames = new Set(resourcesResult.resourceTemplates.map((resource) => resource.name));
      if (!templateNames.has("infomaniak_temp_file")) {
        throw new Error("Missing infomaniak_temp_file resource template");
      }
      return {
        count: resourcesResult.resourceTemplates.length,
        hasTempFileTemplate: true,
      };
    });

    if (hasTool(availableTools, "infomaniak_help")) {
      await runCheck("infomaniak_help", async () => {
        const data = parseJsonContent(await callTool(client, "infomaniak_help", { include_tools: false }));
        return {
          totalTools: data.totalTools,
          groupCount: data.groups?.length ?? 0,
          workflowCount: data.suggestedWorkflows?.length ?? 0,
        };
      });
    }

    if (hasTool(availableTools, "kdrive_list_files")) {
      await runCheck("kdrive_list_files(root)", async () => {
        const data = parseJsonContent(await callTool(client, "kdrive_list_files", {}));
        return { count: data.length, firstItemShape: data[0] ? Object.keys(data[0]).sort().slice(0, 8) : [] };
      });

      if (hasTool(availableTools, "kdrive_list_files_page")) {
        await runCheck("kdrive_list_files_page(root)", async () => {
          const data = parseJsonContent(await callTool(client, "kdrive_list_files_page", { limit: 5 }));
          return {
            returned: data.items?.length ?? 0,
            total: data.total,
            hasCursor: Boolean(data.nextCursor),
          };
        }, { optional: true });
      }

      if (hasTool(availableTools, "kdrive_list_recents")) {
        await runCheck("kdrive_list_recents", async () => {
          const data = parseJsonContent(await callTool(client, "kdrive_list_recents", { limit: 5 }));
          return { type: Array.isArray(data) ? "array" : typeof data, count: Array.isArray(data) ? data.length : undefined };
        }, { optional: true });
      }

      if (hasTool(availableTools, "kdrive_recent_context")) {
        await runCheck("kdrive_recent_context", async () => {
          const data = parseJsonContent(await callTool(client, "kdrive_recent_context", { limit: 5 }));
          return { count: data.count, hasItems: Array.isArray(data.items) };
        }, { optional: true });
      }
    }

    if (hasTool(availableTools, "calendar_list_calendars")) {
      const calendars = await runCheck("calendar_list_calendars", async () => {
        const data = parseJsonContent(await callTool(client, "calendar_list_calendars", {}));
        return { count: data.length, firstCalendarHasId: Boolean(data[0]?.id) };
      });

      await runCheck("calendar_list_events", async () => {
        const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const args = { from, to };
        if (calendars?.firstCalendarHasId) {
          // Let the service choose all calendars; this avoids depending on one calendar shape.
        }
        const data = parseJsonContent(await callTool(client, "calendar_list_events", args));
        return { count: data.length };
      }, { optional: true });

      if (hasTool(availableTools, "meeting_brief")) {
        await runCheck("meeting_brief", async () => {
          const data = parseJsonContent(await callTool(client, "meeting_brief", { days: 7, limit: 5 }));
          return { eventCount: data.eventCount, attendeeCount: data.attendeeEmails?.length ?? 0 };
        }, { optional: true });
      }
    }

    if (hasTool(availableTools, "mail_list_folders")) {
      const mailboxes = hasTool(availableTools, "mail_list_mailboxes")
        ? await runCheck("mail_list_mailboxes", async () => {
            const data = parseJsonContent(await callTool(client, "mail_list_mailboxes", {}));
            return { count: data.length, firstMailboxHasUuid: Boolean(data[0]?.uuid) };
          }, { optional: true })
        : null;

      const mailboxUuid = mailboxes?.firstMailboxHasUuid
        ? firstArrayItem(parseJsonContent(await callTool(client, "mail_list_mailboxes", {})))?.uuid
        : undefined;

      const folders = await runCheck("mail_list_folders", async () => {
        const data = parseJsonContent(await callTool(client, "mail_list_folders", mailboxUuid ? { mailbox_uuid: mailboxUuid } : {}));
        return {
          count: data.length,
          hasInbox: data.some((folder) => String(folder.path ?? folder.name ?? "").toLowerCase() === "inbox" || String(folder.role ?? "").toLowerCase() === "inbox"),
        };
      });

      const inboxArgs = mailboxUuid ? { folder: "INBOX", mailbox_uuid: mailboxUuid, limit: 3, page: 1 } : { folder: "INBOX", limit: 3, page: 1 };
      const queryArgs = mailboxUuid ? { folder: "INBOX", mailbox_uuid: mailboxUuid, limit: 3 } : { folder: "INBOX", limit: 3 };
      const messages = await runCheck("mail_list_messages(INBOX)", async () => {
        const data = parseJsonContent(await callTool(client, "mail_list_messages", inboxArgs));
        return {
          total: data.total,
          returned: data.messages?.length ?? 0,
          firstMessageHasUid: Boolean(data.messages?.[0]?.uid),
        };
      }, { optional: !folders });

      const queried = hasTool(availableTools, "mail_query")
        ? await runCheck("mail_query(INBOX)", async () => {
            const data = parseJsonContent(await callTool(client, "mail_query", queryArgs));
            return {
              total: data.total,
              returned: data.messages?.length ?? 0,
              firstMessageHasUid: Boolean(data.messages?.[0]?.uid),
              hasCursor: Boolean(data.nextCursor),
            };
          }, { optional: true })
        : null;

      if (hasTool(availableTools, "mail_triage_summary")) {
        await runCheck("mail_triage_summary(INBOX)", async () => {
          const data = parseJsonContent(await callTool(client, "mail_triage_summary", queryArgs));
          return {
            returned: data.returned,
            flaggedCount: data.flaggedCount,
            attachmentCount: data.attachmentCount,
          };
        }, { optional: true });
      }

      if (messages?.firstMessageHasUid) {
        await runCheck("mail_read_message(first INBOX message)", async () => {
          const listed = queried?.firstMessageHasUid
            ? parseJsonContent(await callTool(client, "mail_query", queryArgs))
            : parseJsonContent(await callTool(client, "mail_list_messages", inboxArgs));
          const uid = listed.messages?.[0]?.uid;
          const text = parseTextContent(await callTool(client, "mail_read_message", {
            folder: "INBOX",
            uid,
            ...(mailboxUuid ? { mailbox_uuid: mailboxUuid } : {}),
          }));
          return {
            subjectPresent: text.includes("Subject:"),
            fromPresent: text.includes("From:"),
            messageIdPresent: text.includes("Message-ID:"),
            contentLength: text.length,
          };
        }, { optional: true });
      }

      if (sendSelfEmail && hasTool(availableTools, "mail_send")) {
        await runCheck("mail_send(self)", async () => {
          const subject = `infomaniak-mcp smoke ${new Date().toISOString()} ${randomUUID().slice(0, 8)}`;
          const text = parseTextContent(await callTool(client, "mail_send", {
            to: [smokeSelfEmail],
            subject,
            text: `This is a permitted MCP smoke test email sent to ${smokeSelfEmail}.`,
          }));
          return { sentTo: smokeSelfEmail, messageIdPresent: text.includes("Message-ID:") || text.includes("Email sent") };
        }, { timeoutMs: 45000 });
      }
    }

    if (hasTool(availableTools, "contacts_list_address_books")) {
      const books = await runCheck("contacts_list_address_books", async () => {
        const data = parseJsonContent(await callTool(client, "contacts_list_address_books", {}));
        return { count: data.length, firstBookHasUrl: Boolean(data[0]?.url) };
      }, { optional: true });

      await runCheck("contacts_list", async () => {
        const data = parseJsonContent(await callTool(client, "contacts_list", {}));
        return { count: data.length, firstContactHasUrl: Boolean(data[0]?.url), addressBooksVisible: books?.count ?? 0 };
      }, { optional: true });

      if (hasTool(availableTools, "contacts_query")) {
        await runCheck("contacts_query(limit 5)", async () => {
          const data = parseJsonContent(await callTool(client, "contacts_query", { limit: 5 }));
          return { count: data.length, firstContactHasUrl: Boolean(data[0]?.url) };
        }, { optional: true });
      }
    }

    if (hasTool(availableTools, "tasks_list_calendars")) {
      await runCheck("tasks_list_calendars", async () => {
        const data = parseJsonContent(await callTool(client, "tasks_list_calendars", {}));
        return { count: data.length, firstCalendarHasUrl: Boolean(data[0]?.url) };
      }, { optional: true });

      await runCheck("tasks_list(open)", async () => {
        const data = parseJsonContent(await callTool(client, "tasks_list", { status: "open", limit: 10 }));
        return { count: data.length, firstTaskHasId: Boolean(data[0]?.id) };
      }, { optional: true });
    }

    if (hasTool(availableTools, "chk_list_short_urls")) {
      await runCheck("chk_list_short_urls", async () => {
        const data = parseJsonContent(await callTool(client, "chk_list_short_urls", {}));
        return { count: Array.isArray(data) ? data.length : undefined, type: Array.isArray(data) ? "array" : typeof data };
      }, { optional: true });

      if (hasTool(availableTools, "chk_list_short_urls_page")) {
        await runCheck("chk_list_short_urls_page", async () => {
          const data = parseJsonContent(await callTool(client, "chk_list_short_urls_page", { limit: 10 }));
          return { returned: data.items?.length ?? 0, total: data.total };
        }, { optional: true });
      }
    }

    if (hasTool(availableTools, "ai_list_models")) {
      await runCheck("ai_list_models", async () => {
        const data = parseJsonContent(await callTool(client, "ai_list_models", {}));
        return { count: data.length, firstModelHasId: Boolean(data[0]?.id) };
      }, { optional: true });
    }

    if (hasTool(availableTools, "kchat_list_channels")) {
      await runCheck("kchat_list_channels", async () => {
        const data = parseJsonContent(await callTool(client, "kchat_list_channels", { limit: 5 }));
        return { type: Array.isArray(data) ? "array" : typeof data, count: Array.isArray(data) ? data.length : undefined };
      }, { optional: true });

      await runCheck("kchat_get_users", async () => {
        const data = parseJsonContent(await callTool(client, "kchat_get_users", { limit: 5 }));
        return { type: Array.isArray(data) ? "array" : typeof data, count: Array.isArray(data) ? data.length : undefined };
      }, { optional: true });
    }

    const summary = {
      command: serverCommand,
      args: serverArgs,
      codexServer: codexServerName || null,
      sendSelfEmail,
      total: results.length,
      passed: results.filter((entry) => entry.status === "passed").length,
      failed: results.filter((entry) => entry.status === "failed").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      results,
      stderrSummary: stderrChunks.join("").split("\n").filter(Boolean).slice(-20),
    };

    console.log(JSON.stringify(summary, null, 2));
    await transport.close();
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(JSON.stringify({
      fatal: summarizeError(error),
      partialResults: results,
      stderrSummary: stderrChunks.join("").split("\n").filter(Boolean).slice(-20),
    }, null, 2));
    await transport.close();
    process.exit(1);
  }
}

await main();
