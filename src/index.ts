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
  version: "0.1.0",
});

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
if (config.infomaniakToken) {
  registerSwissTransferTools(server, new SwissTransferService(config));
  console.error("[infomaniak-mcp] Swiss Transfer enabled");
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

  registerContactsTools(server, new ContactsService(config));
  console.error("[infomaniak-mcp] Contacts tools enabled (CardDAV)");
}

// ── Warnings ──
if (!config.infomaniakToken && !config.mailUser) {
  console.error(
    "[infomaniak-mcp] Warning: No credentials configured. Set INFOMANIAK_TOKEN and/or MAIL_USER + MAIL_PASSWORD."
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[infomaniak-mcp] Server started");
