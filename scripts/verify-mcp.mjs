#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListPromptsResultSchema, ListResourceTemplatesResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(scriptDir, "..");
loadDotenv({ path: resolve(repoRoot, ".env"), override: false });

const codexServerName = process.env.VERIFY_MCP_CODEX_SERVER ?? "";
const codexConfig = codexServerName ? readCodexMcpConfig(codexServerName) : null;
const serverCommand = process.env.MCP_SERVER_COMMAND ?? codexConfig?.command ?? "node";
const serverArgs = process.env.MCP_SERVER_ARGS
  ? JSON.parse(process.env.MCP_SERVER_ARGS)
  : codexConfig?.args ?? [resolve(repoRoot, "dist/index.js")];

const serverEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...filterEnv(codexConfig?.env ?? {}),
  ...process.env,
};

const transport = new StdioClientTransport({
  command: serverCommand,
  args: serverArgs,
  env: serverEnv,
  stderr: "pipe",
});
const stderrChunks = [];
transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

const client = new Client({
  name: "infomaniak-mcp-verifier",
  version: "1.1.0",
});

try {
  await client.connect(transport);
  const tools = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
  const prompts = await client.request({ method: "prompts/list", params: {} }, ListPromptsResultSchema);
  const resources = await client.request({ method: "resources/templates/list", params: {} }, ListResourceTemplatesResultSchema);

  const summary = {
    command: serverCommand,
    args: serverArgs,
    tools: tools.tools.length,
    prompts: prompts.prompts.length,
    resourceTemplates: resources.resourceTemplates.length,
    hasHelpTool: tools.tools.some((tool) => tool.name === "infomaniak_help"),
    hasTempResourceTemplate: resources.resourceTemplates.some((resource) => resource.name === "infomaniak_temp_file"),
    stderrSummary: stderrChunks.join("").split("\n").filter(Boolean).slice(-10),
  };

  if (!summary.hasHelpTool) {
    throw new Error("Missing infomaniak_help tool");
  }

  if (!summary.hasTempResourceTemplate) {
    throw new Error("Missing infomaniak_temp_file resource template");
  }

  console.log(JSON.stringify(summary, null, 2));
  await transport.close();
} catch (error) {
  console.error(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    stderrSummary: stderrChunks.join("").split("\n").filter(Boolean).slice(-10),
  }, null, 2));
  await transport.close();
  process.exit(1);
}

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
