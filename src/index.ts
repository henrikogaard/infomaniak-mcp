#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { KDriveService } from "./services/kdrive.js";
import { CalendarService } from "./services/calendar.js";
import { MailService } from "./services/mail.js";
import { ContactsService } from "./services/contacts.js";
import { AIService } from "./services/ai.js";
import { ChkService } from "./services/chk.js";
import { KMeetService } from "./services/kmeet.js";
import { SwissTransferService } from "./services/swisstransfer.js";
import { registerKDriveTools } from "./tools/kdrive.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerMailTools } from "./tools/mail.js";
import { registerContactsTools } from "./tools/contacts.js";
import { registerAITools } from "./tools/ai.js";
import { registerChkTools } from "./tools/chk.js";
import { registerKMeetTools } from "./tools/kmeet.js";
import { registerSwissTransferTools } from "./tools/swisstransfer.js";
import { KPasteService } from "./services/kpaste.js";
import { registerKPasteTools } from "./tools/kpaste.js";

const config = loadConfig();

const server = new McpServer({
  name: "infomaniak-ksuite",
  version: "0.1.1",
});

function hasAnyCredential(...values: string[]): boolean {
  return values.some((value) => value.trim().length > 0);
}

function isConfigured(value: string): boolean {
  return value.trim().length > 0;
}

// ── kDrive ──
if (config.infomaniakToken && config.kdriveId) {
  registerKDriveTools(server, new KDriveService(config));
  console.error("[infomaniak-mcp] kDrive tools enabled");
}

// ── Calendar ──
if (config.infomaniakToken) {
  registerCalendarTools(server, new CalendarService(config));
  console.error("[infomaniak-mcp] Calendar tools enabled");
}

// ── AI Tools (Euria) ──
if (config.infomaniakToken && config.aiProductId) {
  registerAITools(server, new AIService(config));
  console.error("[infomaniak-mcp] AI Tools (Euria) enabled");
}

// ── Chk (URL Shortener) ──
if (config.infomaniakToken) {
  registerChkTools(server, new ChkService(config));
  console.error("[infomaniak-mcp] Chk (URL shortener) enabled");
}

// ── kMeet ──
if (config.infomaniakToken) {
  registerKMeetTools(server, new KMeetService(config));
  console.error("[infomaniak-mcp] kMeet enabled");
}

// ── Swiss Transfer ──
if (config.infomaniakToken && config.enableExperimentalSwissTransfer) {
  registerSwissTransferTools(server, new SwissTransferService(config));
  console.error("[infomaniak-mcp] Swiss Transfer enabled (experimental)");
}

// ── kPaste ──
{
  registerKPasteTools(server, new KPasteService(config));
  console.error("[infomaniak-mcp] kPaste enabled");
}

// ── Mail (IMAP/SMTP) ──
if (config.mailUser && config.mailPassword) {
  registerMailTools(server, new MailService(config));
  console.error("[infomaniak-mcp] Mail tools enabled (IMAP/SMTP)");
}

// ── Contacts (CardDAV) ──
if (config.davUser && config.davPassword) {
  registerContactsTools(server, new ContactsService(config));
  console.error("[infomaniak-mcp] Contacts tools enabled (CardDAV)");
}

// ── Warnings ──
if (!config.infomaniakToken && !config.mailUser && !config.davUser) {
  console.error(
    "[infomaniak-mcp] Warning: No credentials configured. Set INFOMANIAK_TOKEN, MAIL_USER + MAIL_PASSWORD, and/or DAV_USER + DAV_PASSWORD."
  );
  console.error(
    "[infomaniak-mcp] Hint: Claude does not automatically inherit your shell exports. Put credentials in the MCP server env block or in a local .env file."
  );
}

if (isConfigured(config.infomaniakToken) && !isConfigured(config.kdriveId)) {
  console.error(
    "[infomaniak-mcp] Warning: INFOMANIAK_TOKEN is set but KDRIVE_ID is missing, so kDrive tools are disabled."
  );
}

if (isConfigured(config.infomaniakToken) && !config.enableExperimentalSwissTransfer) {
  console.error(
    "[infomaniak-mcp] Note: Swiss Transfer tools are disabled by default because the live upload flow is still experimental. Set ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 to opt in."
  );
}

if (hasAnyCredential(config.mailUser, config.mailPassword) && !(isConfigured(config.mailUser) && isConfigured(config.mailPassword))) {
  console.error(
    "[infomaniak-mcp] Warning: MAIL_USER and MAIL_PASSWORD must both be set or mail tools stay disabled."
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
    "[infomaniak-mcp] Note: Contacts fall back to MAIL_USER/MAIL_PASSWORD, but Infomaniak CardDAV usually expects DAV_USER to be your short username (for example AB12345), not your email address."
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[infomaniak-mcp] Server started");
