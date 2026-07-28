#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { KDriveService } from "./services/kdrive.js";
import { CalendarService } from "./services/calendar.js";
import { MailService } from "./services/mail.js";
import { MailApiService } from "./services/mail-api.js";
import { HybridMailService } from "./services/mail-hybrid.js";
import { ContactsService } from "./services/contacts.js";
import { CalDAVTasksService } from "./services/caldav-tasks.js";
import { AIService } from "./services/ai.js";
import { ChkService } from "./services/chk.js";
import { KMeetService } from "./services/kmeet.js";
import { KChatService } from "./services/kchat.js";
import { SwissTransferService } from "./services/swisstransfer.js";
import { registerKDriveTools } from "./tools/kdrive.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerMailTools } from "./tools/mail.js";
import { registerContactsTools } from "./tools/contacts.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerAITools } from "./tools/ai.js";
import { registerChkTools } from "./tools/chk.js";
import { registerKMeetTools } from "./tools/kmeet.js";
import { registerKChatTools } from "./tools/kchat.js";
import { registerSwissTransferTools } from "./tools/swisstransfer.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import { registerHelpTool } from "./tools/help.js";
import { KPasteService } from "./services/kpaste.js";
import { registerKPasteTools } from "./tools/kpaste.js";
import { registerWorkflowPrompts } from "./prompts/workflows.js";
import { registerTempResourceTemplate, defaultTempResourceRegistry } from "./temp-resources.js";
import { createToolFilter, createToolFilteredServer, createToolRegistry, isServiceEnabled, profileToFilterConfig } from "./tool-filter.js";

const config = loadConfig();
const profileFilter = profileToFilterConfig(config.toolProfile);
const toolFilter = createToolFilter({
  services: config.enabledServices || profileFilter?.services || "",
  tools: config.enabledTools || profileFilter?.tools || "",
  disabledTools: mergeCommaLists(profileFilter?.disabledTools, config.disabledTools),
  readOnly: config.readOnly || profileFilter?.readOnly === true,
});

const server = new McpServer({
  name: "infomaniak-ksuite",
  version: "1.1.0",
});
const toolRegistry = createToolRegistry();
const toolServer = createToolFilteredServer(server, toolFilter, toolRegistry);

registerWorkflowPrompts(server);
registerTempResourceTemplate(server, defaultTempResourceRegistry);

if (config.readOnly) {
  console.error("[infomaniak-mcp] Read-only mode enabled; mutating tools are hidden from tools/list.");
}

if (config.toolProfile) {
  console.error(profileFilter
    ? `[infomaniak-mcp] Tool profile enabled: ${config.toolProfile}`
    : `[infomaniak-mcp] Warning: Unknown INFOMANIAK_PROFILE "${config.toolProfile}" ignored.`);
}

function hasAnyCredential(...values: string[]): boolean {
  return values.some((value) => value.trim().length > 0);
}

function isConfigured(value: string): boolean {
  return value.trim().length > 0;
}

function mergeCommaLists(...values: Array<string | undefined>): string {
  return values
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(",");
}

// ── kDrive ──
let kdriveService: KDriveService | undefined;
if (isServiceEnabled(toolFilter, "kdrive") && config.infomaniakToken && config.kdriveId) {
  kdriveService = new KDriveService(config);
  registerKDriveTools(toolServer, kdriveService, { tempResources: defaultTempResourceRegistry });
  console.error("[infomaniak-mcp] kDrive tools enabled");
}

// ── Calendar ──
let calendarService: CalendarService | undefined;
if (isServiceEnabled(toolFilter, "calendar") && config.infomaniakToken) {
  calendarService = new CalendarService(config);
  registerCalendarTools(toolServer, calendarService);
  console.error("[infomaniak-mcp] Calendar tools enabled");
}

// ── AI Tools (Euria) ──
if (isServiceEnabled(toolFilter, "ai") && config.infomaniakToken && config.aiProductId) {
  registerAITools(toolServer, new AIService(config));
  console.error("[infomaniak-mcp] AI Tools (Euria) enabled");
}

// ── Chk (URL Shortener) ──
if (isServiceEnabled(toolFilter, "chk") && config.infomaniakToken) {
  registerChkTools(toolServer, new ChkService(config));
  console.error("[infomaniak-mcp] Chk (URL shortener) enabled");
}

// ── kMeet ──
if (isServiceEnabled(toolFilter, "kmeet") && config.infomaniakToken) {
  registerKMeetTools(toolServer, new KMeetService(config));
  console.error("[infomaniak-mcp] kMeet enabled");
}

// ── kChat ──
if (isServiceEnabled(toolFilter, "kchat") && config.kchatToken && config.kchatTeamName) {
  try {
    registerKChatTools(toolServer, new KChatService({
      token: config.kchatToken,
      teamName: config.kchatTeamName,
    }), { strictExternalSend: config.strictExternalSend });
    console.error("[infomaniak-mcp] kChat enabled");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[infomaniak-mcp] Warning: kChat disabled: ${message}`);
  }
}

// ── Swiss Transfer ──
if (isServiceEnabled(toolFilter, "swisstransfer") && config.infomaniakToken && config.enableExperimentalSwissTransfer) {
  registerSwissTransferTools(toolServer, new SwissTransferService(config), { strictExternalSend: config.strictExternalSend });
  console.error("[infomaniak-mcp] Swiss Transfer enabled (experimental)");
}

// ── kPaste ──
if (isServiceEnabled(toolFilter, "kpaste")) {
  registerKPasteTools(toolServer, new KPasteService(config));
  console.error("[infomaniak-mcp] kPaste enabled");
}

// ── Mail (Infomaniak API preferred, IMAP/SMTP fallback) ──
let hybridMailService: HybridMailService | undefined;
{
  const mailApi = config.mailToken ? new MailApiService({ token: config.mailToken }) : undefined;
  const legacyMail = config.mailUser && config.mailPassword ? new MailService(config) : undefined;

  if (isServiceEnabled(toolFilter, "mail") && (mailApi || legacyMail)) {
    hybridMailService = new HybridMailService({ api: mailApi, legacy: legacyMail });
    registerMailTools(toolServer, hybridMailService, {
      strictExternalSend: config.strictExternalSend,
      tempResources: defaultTempResourceRegistry,
    });
    if (mailApi && legacyMail) {
      console.error("[infomaniak-mcp] Mail tools enabled (API preferred, IMAP/SMTP fallback)");
    } else if (mailApi) {
      console.error("[infomaniak-mcp] Mail tools enabled (Infomaniak Mail API; token needs workspace:mail scope)");
    } else {
      console.error("[infomaniak-mcp] Mail tools enabled (IMAP/SMTP)");
    }
  }
}

// ── Contacts (CardDAV) ──
let contactsService: ContactsService | undefined;
if (isServiceEnabled(toolFilter, "contacts") && config.davUser && config.davPassword) {
  contactsService = new ContactsService(config, { cacheTtlMs: config.davCacheTtlMs });
  registerContactsTools(toolServer, contactsService);
  console.error("[infomaniak-mcp] Contacts tools enabled (CardDAV)");
}

// ── Tasks (CalDAV VTODO) ──
if (isServiceEnabled(toolFilter, "tasks") && config.davUser && config.davPassword) {
  registerTaskTools(toolServer, new CalDAVTasksService(config, { cacheTtlMs: config.davCacheTtlMs }));
  console.error("[infomaniak-mcp] Task tools enabled (CalDAV VTODO)");
}

registerWorkflowTools(toolServer, {
  mail: hybridMailService,
  calendar: calendarService,
  contacts: contactsService,
  kdrive: kdriveService,
});
registerHelpTool(server, () => toolRegistry.tools);

// ── Warnings ──
if (!config.infomaniakToken && !config.mailToken && !config.mailUser && !config.davUser && !config.kchatToken) {
  console.error(
    "[infomaniak-mcp] Warning: No credentials configured. Set INFOMANIAK_TOKEN or MAIL_TOKEN, MAIL_USER + MAIL_PASSWORD, DAV_USER + DAV_PASSWORD, and/or KCHAT_TOKEN + KCHAT_TEAM_NAME."
  );
  console.error(
    "[infomaniak-mcp] Hint: Claude does not automatically inherit your shell exports. Put credentials in the MCP server env block or in a local .env file."
  );
}

if (isServiceEnabled(toolFilter, "kdrive") && isConfigured(config.infomaniakToken) && !isConfigured(config.kdriveId)) {
  console.error(
    "[infomaniak-mcp] Warning: INFOMANIAK_TOKEN is set but KDRIVE_ID is missing, so kDrive tools are disabled."
  );
}

if (isServiceEnabled(toolFilter, "swisstransfer") && isConfigured(config.infomaniakToken) && !config.enableExperimentalSwissTransfer) {
  console.error(
    "[infomaniak-mcp] Note: Swiss Transfer tools are disabled by default because the live upload flow is still experimental. Set ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 to opt in."
  );
}

if (hasAnyCredential(config.mailUser, config.mailPassword) && !(isConfigured(config.mailUser) && isConfigured(config.mailPassword))) {
  console.error(
    "[infomaniak-mcp] Warning: MAIL_USER and MAIL_PASSWORD must both be set or mail tools stay disabled."
  );
}

if (hasAnyCredential(config.kchatToken, config.kchatTeamName) && !(isConfigured(config.kchatToken) && isConfigured(config.kchatTeamName))) {
  console.error(
    "[infomaniak-mcp] Warning: KCHAT_TOKEN and KCHAT_TEAM_NAME must both be set or kChat tools stay disabled."
  );
}

if (hasAnyCredential(process.env.DAV_USER ?? "", process.env.DAV_PASSWORD ?? "") &&
  !(isConfigured(process.env.DAV_USER ?? "") && isConfigured(process.env.DAV_PASSWORD ?? ""))) {
  console.error(
    "[infomaniak-mcp] Warning: DAV_USER and DAV_PASSWORD must both be set or contacts tools may fail to authenticate."
  );
}

if (!isConfigured(process.env.DAV_USER ?? "") && isConfigured(config.mailUser) && config.mailUser.includes("@")) {
  console.error(
    "[infomaniak-mcp] Note: Contacts/Tasks fall back to MAIL_USER/MAIL_PASSWORD, but Infomaniak DAV usually expects DAV_USER to be your short username (for example AB12345), not your email address."
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[infomaniak-mcp] Server started");
