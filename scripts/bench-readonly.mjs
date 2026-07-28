#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(scriptDir, "..");
loadDotenv({ path: resolve(repoRoot, ".env"), override: false });

const codexServerName = process.env.BENCH_CODEX_SERVER ?? process.env.SMOKE_CODEX_SERVER ?? "";
const codexConfig = codexServerName ? readCodexMcpConfig(codexServerName) : null;
const serverCommand = process.env.MCP_SERVER_COMMAND ?? codexConfig?.command ?? "node";
const serverArgs = process.env.MCP_SERVER_ARGS
  ? JSON.parse(process.env.MCP_SERVER_ARGS)
  : codexConfig?.args ?? [resolve(repoRoot, "dist/index.js")];

const iterations = parsePositiveInt(process.env.BENCH_ITERATIONS, 5);
const warmupIterations = parsePositiveInt(process.env.BENCH_WARMUP_ITERATIONS, 1);
const timeoutMs = parsePositiveInt(process.env.BENCH_TIMEOUT_MS, 30000);

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

function filterEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ""));
}

function parsePositiveInt(value, fallback) {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function textContent(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function resultData(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = textContent(result);
  return text ? JSON.parse(text) : null;
}

function summarizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function percentile(sortedSamples, percentileValue) {
  if (sortedSamples.length === 0) return 0;
  const index = Math.min(sortedSamples.length - 1, Math.ceil((percentileValue / 100) * sortedSamples.length) - 1);
  return sortedSamples[index];
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    samplesMs: samples.map((value) => Math.round(value)),
    minMs: Math.round(sorted[0] ?? 0),
    maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
    avgMs: Math.round(total / Math.max(1, samples.length)),
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
  };
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function measure(name, fn) {
  for (let index = 0; index < warmupIterations; index += 1) {
    await withTimeout(fn(), `${name} warmup`);
  }

  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await withTimeout(fn(), `${name} iteration ${index + 1}`);
    samples.push(performance.now() - startedAt);
  }

  return { name, status: "passed", ...summarizeSamples(samples) };
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
    throw new Error(textContent(result) || `${name} returned isError`);
  }

  return result;
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
    name: "infomaniak-readonly-bench",
    version: "1.1.0",
  });
  client.onerror = (error) => {
    stderrChunks.push(`\n[client-error] ${summarizeError(error)}`);
  };

  await client.connect(transport);

  try {
    let toolsResult = null;
    const probes = [];
    probes.push({
      name: "tools/list",
      run: async () => {
        toolsResult = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        return toolsResult;
      },
    });

    await probes[0].run();
    const tools = new Set(toolsResult.tools.map((tool) => tool.name));

    let mailboxUuid;
    if (tools.has("mail_list_mailboxes")) {
      try {
        const mailboxes = resultData(await callTool(client, "mail_list_mailboxes", {}));
        mailboxUuid = Array.isArray(mailboxes) ? mailboxes[0]?.uuid : undefined;
      } catch {
        mailboxUuid = undefined;
      }
    }

    const inboxQueryArgs = mailboxUuid
      ? { folder: "INBOX", mailbox_uuid: mailboxUuid, limit: 5 }
      : { folder: "INBOX", limit: 5 };

    let firstInboxUid;
    if (tools.has("mail_query")) {
      try {
        const query = resultData(await callTool(client, "mail_query", inboxQueryArgs));
        firstInboxUid = query?.messages?.[0]?.uid;
      } catch {
        firstInboxUid = undefined;
      }
    }

    if (tools.has("mail_query")) {
      probes.push({ name: "mail_query(INBOX)", run: () => callTool(client, "mail_query", inboxQueryArgs) });
    }
    if (tools.has("mail_triage_summary")) {
      probes.push({ name: "mail_triage_summary(INBOX)", run: () => callTool(client, "mail_triage_summary", inboxQueryArgs) });
    }
    if (tools.has("mail_read_message") && firstInboxUid) {
      probes.push({
        name: "mail_read_message(metadata)",
        run: () => callTool(client, "mail_read_message", {
          folder: "INBOX",
          uid: firstInboxUid,
          include_body: false,
          ...(mailboxUuid ? { mailbox_uuid: mailboxUuid } : {}),
        }),
      });
    }
    if (tools.has("kdrive_list_files")) {
      probes.push({ name: "kdrive_list_files(root)", run: () => callTool(client, "kdrive_list_files", {}) });
    }
    if (tools.has("kdrive_list_files_page")) {
      probes.push({ name: "kdrive_list_files_page(root)", run: () => callTool(client, "kdrive_list_files_page", { limit: 25 }) });
    }
    if (tools.has("kdrive_recent_context")) {
      probes.push({ name: "kdrive_recent_context", run: () => callTool(client, "kdrive_recent_context", { limit: 10 }) });
    }
    if (tools.has("calendar_list_events")) {
      probes.push({
        name: "calendar_list_events(14d)",
        run: () => callTool(client, "calendar_list_events", {
          from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      });
    }
    if (tools.has("meeting_brief")) {
      probes.push({ name: "meeting_brief(7d)", run: () => callTool(client, "meeting_brief", { days: 7, limit: 10 }) });
    }
    if (tools.has("contacts_query")) {
      probes.push({ name: "contacts_query(limit 25)", run: () => callTool(client, "contacts_query", { limit: 25 }) });
    } else if (tools.has("contacts_list")) {
      probes.push({ name: "contacts_list(limit 25)", run: () => callTool(client, "contacts_list", { limit: 25 }) });
    }
    if (tools.has("tasks_list")) {
      probes.push({ name: "tasks_list(open)", run: () => callTool(client, "tasks_list", { status: "open", limit: 10 }) });
    }
    if (tools.has("chk_list_short_urls_page")) {
      probes.push({ name: "chk_list_short_urls_page", run: () => callTool(client, "chk_list_short_urls_page", { limit: 25 }) });
    }

    const results = [];
    for (const probe of probes) {
      process.stderr.write(`[bench:readonly] ${probe.name}\n`);
      try {
        results.push(await measure(probe.name, probe.run));
      } catch (error) {
        results.push({ name: probe.name, status: "failed", error: summarizeError(error) });
      }
    }

    const summary = {
      command: serverCommand,
      args: serverArgs,
      codexServer: codexServerName || null,
      iterations,
      warmupIterations,
      timeoutMs,
      tools: toolsResult.tools.length,
      failed: results.filter((entry) => entry.status === "failed").length,
      results,
      stderrSummary: stderrChunks.join("").split("\n").filter(Boolean).slice(-20),
    };

    console.log(JSON.stringify(summary, null, 2));
    await transport.close();
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(JSON.stringify({
      fatal: summarizeError(error),
      stderrSummary: stderrChunks.join("").split("\n").filter(Boolean).slice(-20),
    }, null, 2));
    await transport.close();
    process.exit(1);
  }
}

await main();
