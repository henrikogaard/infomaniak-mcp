# AGENTS.md — Project context for AI agents

## What this is

A unified MCP (Model Context Protocol) server for Infomaniak kSuite. It gives AI agents (Codex, Cursor, etc.) access to kDrive, Calendar, Mail, Contacts, AI Tools (Euria), Swiss Transfer, kMeet, Chk, and kPaste — all through one server process.

## Tech stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js (ES2022, ESM modules)
- **MCP SDK**: `@modelcontextprotocol/sdk` — uses `McpServer` + `StdioServerTransport`
- **Mail**: `imapflow` (IMAP), `nodemailer` (SMTP), `mailparser` (parsing)
- **Contacts**: `tsdav` (CardDAV client)
- **Validation**: `zod` (tool parameter schemas)

## Project structure

```
src/
├── index.ts              # Entry point — wires services + tools, starts MCP server
├── config.ts             # Environment variable config loader
├── tool-handler.ts       # safeHandler wrapper (error boundaries), textResult/jsonResult helpers
├── services/             # Business logic — one file per Infomaniak service
│   ├── infomaniak-api.ts # Shared HTTP client for api.infomaniak.com (Bearer token auth)
│   ├── kdrive.ts         # kDrive file operations
│   ├── calendar.ts       # Calendar event CRUD
│   ├── mail.ts           # IMAP/SMTP mail operations
│   ├── contacts.ts       # CardDAV contact operations
│   ├── ai.ts             # Euria AI (OpenAI-compatible endpoints)
│   ├── swisstransfer.ts  # Swiss Transfer file sharing
│   ├── kmeet.ts          # kMeet video rooms
│   ├── chk.ts            # Chk URL shortener
│   └── kpaste.ts         # kPaste encrypted pastes (PrivateBin v2)
└── tools/                # MCP tool registrations — one file per service
    ├── kdrive.ts         # 9 tools
    ├── calendar.ts       # 5 tools
    ├── mail.ts           # 8 tools
    ├── contacts.ts       # 7 tools
    ├── ai.ts             # 4 tools
    ├── swisstransfer.ts  # 2 tools
    ├── kmeet.ts          # 3 tools
    ├── chk.ts            # 3 tools
    └── kpaste.ts         # 1 tool
```

## Build & run

```bash
npm install
npm run build          # tsc → dist/
npm start              # node dist/index.js
```

## Key patterns

### Adding a new tool
1. Add service method in `src/services/<service>.ts`
2. Register the tool in `src/tools/<service>.ts` using `server.tool()` with zod schema
3. Wrap handler with `safeHandler()` and use `textResult()` / `jsonResult()` helpers
4. Wire into `src/index.ts` if it's a new service (check credentials, register conditionally)

### Tool handler pattern
```typescript
server.tool(
  "tool_name",
  "Description for the AI",
  { param: z.string().describe("What this param is") },
  safeHandler(async ({ param }) => {
    const result = await service.doSomething(param);
    return jsonResult(result);    // or textResult("...")
  })
);
```

### Error handling
All tools are wrapped in `safeHandler` which catches exceptions and returns `{ isError: true, content: [...] }` instead of crashing. Never throw from a tool handler without safeHandler.

### Service credential gating
In `index.ts`, each service block checks for required env vars before registering tools:
```typescript
if (config.infomaniakToken && config.kdriveId) {
  registerKDriveTools(server, new KDriveService(config));
}
```

## Infomaniak API details

### REST API (api.infomaniak.com)
- Auth: `Authorization: Bearer <token>` header
- Response format: `{ "result": "success", "data": <payload> }`
- Rate limit: 60 requests/minute
- kDrive endpoints: `/2/drive/{id}/files/...` and `/3/drive/{id}/files/...`
- Calendar endpoints: `/1/calendar/pim/...` (undocumented internal API)
- Profile: `GET /2/profile` (timezone, email)
- Chk: `POST /1/url-shortener`
- kMeet: `/1/meet/room` (inferred, needs verification)

### IMAP/SMTP (mail.infomaniak.com)
- IMAP: port 993, SSL
- SMTP: port 587, STARTTLS (or 465 for SSL)
- Auth: full email address + password

### CardDAV / CalDAV (sync.infomaniak.com)
- Standard CardDAV/CalDAV protocol, base URL: `https://sync.infomaniak.com/`
- Auth: Basic — uses short Infomaniak username (e.g. `abc12345`), NOT the email address
- With 2FA: must use app password from https://manager.infomaniak.com/v3/profile/application-password
- Find username: https://config.infomaniak.com/ → "My Contacts"/"My Calendar" → "Manual synchronization" → "User name"
- Separate env vars: `DAV_USER` + `DAV_PASSWORD` (falls back to `MAIL_USER` + `MAIL_PASSWORD`)
- Discovery: `/.well-known/carddav` / `/.well-known/caldav`
- Contact groups stored as CATEGORIES (not vCard groups)

### kPaste (kpaste.infomaniak.com)
- PrivateBin v2 protocol
- Client-side AES-256-GCM encryption
- PBKDF2 key derivation (100k iterations)
- Content zlib-compressed before encryption
- Key in URL fragment (never sent to server)

## Known issues & backlog

See CHANGELOG.md for full backlog. Key items:
- Swiss Transfer, kMeet, Chk endpoints need real-world verification
- Mail needs connection pooling for performance
- Missing: file sharing links, attachment download, recurring calendar events, newsletter API
