#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

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
if (smokeSelfEmail !== "henrik@ogard.no") {
  throw new Error("Refusing to run owned write smoke: SMOKE_SELF_EMAIL must be henrik@ogard.no");
}

const marker = `MCP Smoke Owned ${new Date().toISOString()} ${randomUUID().slice(0, 8)}`;
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
const cleanupResults = [];
const created = {
  kdriveFileIds: [],
  kdriveFolderIds: [],
  calendarEventIds: [],
  contactUrls: [],
  taskIds: [],
  chkIds: [],
  mailTargets: [],
};

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
  return JSON.parse(parseTextContent(result));
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
  const timeoutMs = options.timeoutMs ?? 45000;
  console.error(`[smoke:write-owned] ${name}`);

  try {
    const details = await withTimeout(fn(), timeoutMs, name);
    results.push({ name, status: "passed", durationMs: Date.now() - startedAt, details });
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

async function cleanup(name, fn) {
  const startedAt = Date.now();
  console.error(`[smoke:write-owned:cleanup] ${name}`);
  try {
    const details = await withTimeout(fn(), 45000, `cleanup ${name}`);
    cleanupResults.push({ name, status: "passed", durationMs: Date.now() - startedAt, details });
  } catch (error) {
    cleanupResults.push({ name, status: "failed", durationMs: Date.now() - startedAt, details: summarizeError(error) });
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

function toYmdHms(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function extractContactUrl(text) {
  const match = text.match(/Contact created: (.+)$/m);
  if (!match) throw new Error(`Could not parse contact URL from response: ${text}`);
  return match[1].trim();
}

function findKDriveParent(rootItems) {
  const privateFolder = rootItems.find((entry) => String(entry.name).toLowerCase() === "private" && ["dir", "folder", "directory"].includes(String(entry.type).toLowerCase()));
  const firstFolder = rootItems.find((entry) => ["dir", "folder", "directory"].includes(String(entry.type).toLowerCase()));
  return privateFolder?.id ?? firstFolder?.id ?? 1;
}

async function cleanupMailBySubject(client, subject) {
  for (const folder of ["INBOX", "Sent"]) {
    const found = parseJsonContent(await callTool(client, "mail_search", { folder, query: subject, limit: 10 }));
    for (const message of found) {
      const read = parseTextContent(await callTool(client, "mail_read_message", { folder, uid: message.uid }));
      if (!read.includes(`Subject: ${subject}`)) continue;
      await callTool(client, "mail_delete", { folder, uid: message.uid });
    }
  }
}

async function main() {
  const stderrChunks = [];
  const transport = new StdioClientTransport({
    command: serverCommand,
    args: serverArgs,
    env: serverEnv,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

  const client = new Client({
    name: "infomaniak-owned-write-smoke",
    version: "1.0.0",
  });
  client.onerror = (error) => {
    stderrChunks.push(`\n[client-error] ${summarizeError(error)}`);
  };

  await client.connect(transport);

  try {
    const toolsResult = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
    const availableTools = new Set(toolsResult.tools.map((tool) => tool.name));

    await runCheck("tools/list", async () => ({
      count: toolsResult.tools.length,
      canWriteKDrive: hasTool(availableTools, "kdrive_upload_file"),
      canWriteCalendar: hasTool(availableTools, "calendar_create_event"),
      canWriteTasks: hasTool(availableTools, "tasks_create"),
      canWriteContacts: hasTool(availableTools, "contacts_create"),
      canWriteMail: hasTool(availableTools, "mail_send"),
      canWriteChk: hasTool(availableTools, "chk_create_short_url"),
    }));

    if (hasTool(availableTools, "kdrive_create_folder")) {
      await runCheck("kDrive create/upload/rename/move/delete owned file", async () => {
        const rootItems = parseJsonContent(await callTool(client, "kdrive_list_files", {}));
        const parentId = findKDriveParent(rootItems);
        const folderA = parseJsonContent(await callTool(client, "kdrive_create_folder", {
          parent_id: parentId,
          name: `${marker} A`,
        }));
        created.kdriveFolderIds.push(folderA.id);

        const folderB = parseJsonContent(await callTool(client, "kdrive_create_folder", {
          parent_id: parentId,
          name: `${marker} B`,
        }));
        created.kdriveFolderIds.push(folderB.id);

        const uploaded = parseJsonContent(await callTool(client, "kdrive_upload_file", {
          folder_id: folderA.id,
          filename: "owned-smoke.txt",
          base64_content: Buffer.from(marker, "utf8").toString("base64"),
        }));
        created.kdriveFileIds.push(uploaded.id);

        const renamed = parseJsonContent(await callTool(client, "kdrive_rename", {
          file_id: uploaded.id,
          name: "owned-smoke-renamed.txt",
        }));
        await callTool(client, "kdrive_move", {
          file_id: uploaded.id,
          destination_folder_id: folderB.id,
        });
        const destinationItems = parseJsonContent(await callTool(client, "kdrive_list_files", {
          folder_id: folderB.id,
        }));
        const movedFile = destinationItems.find((entry) => entry.id === uploaded.id || entry.name === "owned-smoke-renamed.txt");
        if (!movedFile) {
          throw new Error("Moved kDrive file was not found in the destination folder");
        }

        await callTool(client, "kdrive_delete", { file_id: uploaded.id, confirmation: `MOVE ${uploaded.id} TO TRASH` });
        created.kdriveFileIds = created.kdriveFileIds.filter((id) => id !== uploaded.id);
        await callTool(client, "kdrive_delete", { file_id: folderA.id, confirmation: `MOVE ${folderA.id} TO TRASH` });
        created.kdriveFolderIds = created.kdriveFolderIds.filter((id) => id !== folderA.id);
        await callTool(client, "kdrive_delete", { file_id: folderB.id, confirmation: `MOVE ${folderB.id} TO TRASH` });
        created.kdriveFolderIds = created.kdriveFolderIds.filter((id) => id !== folderB.id);

        return {
          parentId,
          folderA: Boolean(folderA.id),
          folderB: Boolean(folderB.id),
          uploaded: Boolean(uploaded.id),
          renamed: renamed.name,
          moved: true,
          cleanup: "deleted created file and folders",
        };
      });
    }

    if (hasTool(availableTools, "calendar_create_event")) {
      await runCheck("Calendar create/update/delete owned event", async () => {
        const calendars = parseJsonContent(await callTool(client, "calendar_list_calendars", {}));
        const calendar = calendars[0];
        if (!calendar?.id) throw new Error("No calendar available");
        const start = new Date(Date.now() + 36 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const event = parseJsonContent(await callTool(client, "calendar_create_event", {
          calendar_id: String(calendar.id),
          title: marker,
          start: toYmdHms(start),
          end: toYmdHms(end),
          description: "Owned write smoke event",
        }));
        created.calendarEventIds.push(String(event.id));

        const updated = parseJsonContent(await callTool(client, "calendar_update_event", {
          event_id: String(event.id),
          title: `${marker} updated`,
          description: "Owned write smoke event updated",
        }));

        await callTool(client, "calendar_delete_event", { event_id: String(event.id), confirmation: `DELETE EVENT ${event.id}` });
        created.calendarEventIds = created.calendarEventIds.filter((id) => id !== String(event.id));
        return { calendarId: calendar.id, eventIdPresent: Boolean(event.id), updatedTitle: updated.title, cleanup: "deleted created event" };
      });
    }

    if (hasTool(availableTools, "tasks_create")) {
      await runCheck("Tasks create/update/complete/delete owned task", async () => {
        const task = parseJsonContent(await callTool(client, "tasks_create", {
          title: marker,
          description: "Owned write smoke task",
          due: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          categories: ["mcp-smoke"],
        }));
        created.taskIds.push(task.id);

        const updated = parseJsonContent(await callTool(client, "tasks_update", {
          task_id: task.id,
          description: "Owned write smoke task updated",
          categories: ["mcp-smoke", "updated"],
        }));
        const completed = parseJsonContent(await callTool(client, "tasks_complete", {
          task_id: task.id,
          completed: true,
        }));

        await callTool(client, "tasks_delete", { task_id: task.id, confirmation: `DELETE TASK ${task.id}` });
        created.taskIds = created.taskIds.filter((id) => id !== task.id);
        return {
          taskIdPresent: Boolean(task.id),
          updatedCategories: updated.categories,
          completed: completed.completed,
          cleanup: "deleted created task",
        };
      });
    }

    if (hasTool(availableTools, "contacts_create")) {
      await runCheck("Contacts create/update/get/delete owned contact", async () => {
        const text = parseTextContent(await callTool(client, "contacts_create", {
          display_name: marker,
          email: `owned-${randomUUID().slice(0, 8)}@example.invalid`,
          organization: "MCP Owned Smoke",
        }));
        const contactUrl = extractContactUrl(text);
        created.contactUrls.push(contactUrl);

        await callTool(client, "contacts_update", {
          contact_url: contactUrl,
          organization: "MCP Owned Smoke Updated",
          phone: "+41000000000",
        });
        const contact = parseJsonContent(await callTool(client, "contacts_get", { contact_url: contactUrl }));

        await callTool(client, "contacts_delete", { contact_url: contactUrl, confirmation: `DELETE CONTACT ${contactUrl}` });
        created.contactUrls = created.contactUrls.filter((url) => url !== contactUrl);
        return { contactUrlPresent: Boolean(contactUrl), displayName: contact.displayName, cleanup: "deleted created contact" };
      });
    }

    if (hasTool(availableTools, "chk_create_short_url")) {
      await runCheck("Chk create/list/delete owned short URL", async () => {
        const shortUrl = parseJsonContent(await callTool(client, "chk_create_short_url", {
          url: "https://example.com/",
        }));
        const id = shortUrl.id ?? shortUrl.uuid ?? shortUrl.short_code;
        if (!id) throw new Error(`Could not identify Chk id from ${JSON.stringify(shortUrl)}`);
        created.chkIds.push(String(id));
        await callTool(client, "chk_list_short_urls", {});
        await callTool(client, "chk_delete_short_url", { id: String(id), confirmation: `DELETE SHORT URL ${id}` });
        created.chkIds = created.chkIds.filter((entry) => entry !== String(id));
        return { idPresent: Boolean(id), shortUrlPresent: Boolean(shortUrl.short_url ?? shortUrl.url), cleanup: "deleted created short URL" };
      });
    }

    if (hasTool(availableTools, "mail_send")) {
      await runCheck("Mail send self and delete owned message copies", async () => {
        const subject = `${marker} mail`;
        await callTool(client, "mail_send", {
          to: [smokeSelfEmail],
          subject,
          text: `Owned write smoke email for ${smokeSelfEmail}. Subject marker: ${subject}`,
        });
        created.mailTargets.push(subject);

        // Give delivery/indexing a moment before searching IMAP folders.
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
        await cleanupMailBySubject(client, subject);
        created.mailTargets = created.mailTargets.filter((entry) => entry !== subject);
        return { sentTo: smokeSelfEmail, subject, cleanup: "deleted matching owned copies found in INBOX/Sent" };
      }, { timeoutMs: 90000 });
    }
  } finally {
    for (const subject of [...created.mailTargets]) {
      await cleanup(`mail:${subject}`, async () => {
        await cleanupMailBySubject(client, subject);
        created.mailTargets = created.mailTargets.filter((entry) => entry !== subject);
        return "deleted matching owned copies found in INBOX/Sent";
      });
    }

    for (const id of [...created.chkIds]) {
      await cleanup(`chk:${id}`, async () => {
        await callTool(client, "chk_delete_short_url", { id, confirmation: `DELETE SHORT URL ${id}` });
        created.chkIds = created.chkIds.filter((entry) => entry !== id);
        return "deleted";
      });
    }

    for (const url of [...created.contactUrls]) {
      await cleanup(`contact:${url}`, async () => {
        await callTool(client, "contacts_delete", { contact_url: url, confirmation: `DELETE CONTACT ${url}` });
        created.contactUrls = created.contactUrls.filter((entry) => entry !== url);
        return "deleted";
      });
    }

    for (const id of [...created.taskIds]) {
      await cleanup(`task:${id}`, async () => {
        await callTool(client, "tasks_delete", { task_id: id, confirmation: `DELETE TASK ${id}` });
        created.taskIds = created.taskIds.filter((entry) => entry !== id);
        return "deleted";
      });
    }

    for (const id of [...created.calendarEventIds]) {
      await cleanup(`calendar:${id}`, async () => {
        await callTool(client, "calendar_delete_event", { event_id: id, confirmation: `DELETE EVENT ${id}` });
        created.calendarEventIds = created.calendarEventIds.filter((entry) => entry !== id);
        return "deleted";
      });
    }

    for (const id of [...created.kdriveFileIds]) {
      await cleanup(`kdrive-file:${id}`, async () => {
        await callTool(client, "kdrive_delete", { file_id: id, confirmation: `MOVE ${id} TO TRASH` });
        created.kdriveFileIds = created.kdriveFileIds.filter((entry) => entry !== id);
        return "deleted";
      });
    }

    for (const id of [...created.kdriveFolderIds].reverse()) {
      await cleanup(`kdrive-folder:${id}`, async () => {
        await callTool(client, "kdrive_delete", { file_id: id, confirmation: `MOVE ${id} TO TRASH` });
        created.kdriveFolderIds = created.kdriveFolderIds.filter((entry) => entry !== id);
        return "deleted";
      });
    }
  }

  const summary = {
    command: serverCommand,
    args: serverArgs,
    codexServer: codexServerName || null,
    marker,
    total: results.length,
    passed: results.filter((entry) => entry.status === "passed").length,
    failed: results.filter((entry) => entry.status === "failed").length,
    skipped: results.filter((entry) => entry.status === "skipped").length,
    cleanupFailed: cleanupResults.filter((entry) => entry.status === "failed").length,
    results,
    cleanupResults,
    leftovers: created,
    stderrSummary: stderrChunks.join("").split("\n").filter(Boolean).slice(-20),
  };

  console.log(JSON.stringify(summary, null, 2));
  await transport.close();
  process.exit(summary.failed > 0 || summary.cleanupFailed > 0 ? 1 : 0);
}

await main();
