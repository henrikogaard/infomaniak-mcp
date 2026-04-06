# Infomaniak kSuite MCP Server

A unified [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives AI agents full access to your Infomaniak kSuite ecosystem. One server, one config — stable tools for kDrive, Calendar, Mail, Contacts, kMeet, Chk, and kPaste, plus optional AI tools and experimental Swiss Transfer support.

All data stays on Swiss infrastructure. Your credentials never leave your machine.

## Services

| Service | Protocol | Tools | Description |
|---------|----------|-------|-------------|
| **kDrive** | REST API | 9 | Cloud storage — search, browse, download, upload, create, move, rename, delete files |
| **Calendar** | REST API | 5 | Calendar management — list, create, update, delete events |
| **Mail** | IMAP/SMTP | 8 | Email — read, search, send, move, delete, flag messages |
| **Contacts** | CardDAV | 7 | Address book — list, search, get, create, update, delete contacts |
| **AI Tools (Euria)** | REST API | 4 | Sovereign Swiss AI — chat, embeddings, audio transcription |
| **Swiss Transfer** | REST API | 2 experimental | Encrypted file sharing up to 50 GB (disabled by default) |
| **kMeet** | REST API | 3 | Video conferencing room management |
| **Chk** | REST API | 3 | URL shortener with QR codes |
| **kPaste** | PrivateBin | 1 | Zero-knowledge encrypted secret sharing |

---

## Quick Start

### 1. Install

If you just want to use the MCP server, install or run the published package:

```bash
npx -y @henrikogard/infomaniak-mcp
```

Or install it globally:

```bash
npm install -g @henrikogard/infomaniak-mcp
mcp-server-infomaniak
```

### 2. Build from source

```bash
git clone https://github.com/henrikogaard/infomaniak-mcp.git
cd infomaniak-mcp
npm install
npm run build
```

If you run the server directly from this repo, it will also auto-load a project-level `.env` file.

### 3. Get your credentials

**Infomaniak API token** (for kDrive, Calendar, AI, Chk, kMeet, and experimental Swiss Transfer):
1. Go to [Infomaniak Token Manager](https://manager.infomaniak.com/v3/ng/accounts/token)
2. Create a token with scopes: `drive`, `workspace:calendar`, `user_info`

**kDrive ID**: Open your kDrive in the browser — the numeric ID is in the URL:
`https://kdrive.infomaniak.com/app/drive/XXXXX/files` → `XXXXX` is your drive ID.

**AI Tools product ID** (optional): If you have an AI Tools subscription, find the product ID in the Infomaniak Manager under AI Tools.

**Mail credentials**: Your full Infomaniak email address and password. If you have 2FA enabled, create an app-specific password.

**CardDAV/CalDAV credentials** (for Contacts):
- **Username**: Your short Infomaniak username (e.g. `abc12345`) — **not** your email address
- **Password**: Your account password, or an **app password** if you have 2FA enabled
- To find your username: log in at [config.infomaniak.com](https://config.infomaniak.com/) → select "My Contacts" or "My Calendar" → "Manual synchronization" → look for "User name"
- To generate an app password (required with 2FA): go to [manager.infomaniak.com/v3/profile/application-password](https://manager.infomaniak.com/v3/profile/application-password)

### 4. Configure your AI client

**Claude Code** — add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "node",
      "args": ["/absolute/path/to/infomaniak-mcp/dist/index.js"],
      "env": {
        "INFOMANIAK_TOKEN": "your-api-token",
        "KDRIVE_ID": "123456",
        "AI_PRODUCT_ID": "789",
        "MAIL_USER": "you@ik.me",
        "MAIL_PASSWORD": "your-password",
        "DAV_USER": "AB12345",
        "DAV_PASSWORD": "your-dav-password"
      }
    }
  }
}
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "infomaniak": {
      "command": "node",
      "args": ["/absolute/path/to/infomaniak-mcp/dist/index.js"],
      "env": {
        "INFOMANIAK_TOKEN": "your-api-token",
        "KDRIVE_ID": "123456",
        "AI_PRODUCT_ID": "789",
        "MAIL_USER": "you@ik.me",
        "MAIL_PASSWORD": "your-password",
        "DAV_USER": "AB12345",
        "DAV_PASSWORD": "your-dav-password"
      }
    }
  }
}
```

**Codex** — this server works directly as a local STDIO MCP server.

You can add it with the Codex CLI:

```bash
codex mcp add infomaniak \
  --env INFOMANIAK_TOKEN=your-api-token \
  --env KDRIVE_ID=123456 \
  --env AI_PRODUCT_ID=789 \
  --env MAIL_USER=you@ik.me \
  --env MAIL_PASSWORD=your-password \
  --env DAV_USER=AB12345 \
  --env DAV_PASSWORD=your-dav-password \
  -- node /absolute/path/to/infomaniak-mcp/dist/index.js
```

Then verify it:

```bash
codex mcp list
```

Or add it directly to `~/.codex/config.toml`:

```toml
[mcp_servers.infomaniak]
command = "node"
args = ["/absolute/path/to/infomaniak-mcp/dist/index.js"]

[mcp_servers.infomaniak.env]
INFOMANIAK_TOKEN = "your-api-token"
KDRIVE_ID = "123456"
AI_PRODUCT_ID = "789"
MAIL_USER = "you@ik.me"
MAIL_PASSWORD = "your-password"
DAV_USER = "AB12345"
DAV_PASSWORD = "your-dav-password"
```

Codex CLI and the IDE extension share this configuration. If you use the Codex desktop app, it also picks up your existing Codex configuration.

**ChatGPT** — this repository does **not** plug straight into ChatGPT in its current form.

Why: this MCP server currently runs over local `stdio`, while ChatGPT Apps/connectors expect a publicly reachable **HTTPS** MCP endpoint such as `https://your-domain.example/mcp`.

That means:
- you cannot point ChatGPT directly at `node dist/index.js`
- you need an HTTP MCP wrapper or deployment layer in front of this server before ChatGPT can connect to it

If you add an HTTPS `/mcp` endpoint later, the ChatGPT flow is:
1. Enable developer mode in ChatGPT under `Settings -> Apps & Connectors -> Advanced settings`
2. Go to `Settings -> Connectors -> Create`
3. Enter a connector name, description, and the public HTTPS `/mcp` URL
4. Open a new chat, click `+`, then choose your connector from the tools list

For local development, OpenAI recommends tunneling your local HTTP MCP endpoint with a tool such as `ngrok` or Cloudflare Tunnel.

**Cursor / Windsurf / other MCP clients** — similar JSON format, see your client's docs.

> **Note**: MCP servers run locally on your computer as a subprocess. They don't work on mobile (Claude iOS/Android app). You need a desktop client.

### 5. Verify the server

The default server surface is intended to be the stable, publishable one. Experimental SwissTransfer tools stay hidden unless you explicitly opt in.

```bash
npm run build
npm run smoke:live
```

What to expect from the live smoke:
- enabled services are exercised against your real credentials
- AI checks are skipped if `AI_PRODUCT_ID` is not configured
- SwissTransfer checks are skipped unless `ENABLE_EXPERIMENTAL_SWISSTRANSFER=1` is set
- the "sent copy" mail verification can be flaky if your Sent folder updates slowly

---

## All Tools

### kDrive

Requires: `INFOMANIAK_TOKEN` + `KDRIVE_ID`

| Tool | Description |
|------|-------------|
| `kdrive_search` | Search files by name or content |
| `kdrive_list_files` | List files and folders in a directory |
| `kdrive_get_file` | Get metadata for a specific file |
| `kdrive_download_file` | Download file content (base64, with size guard) |
| `kdrive_upload_file` | Upload a file (base64 content) |
| `kdrive_create_folder` | Create a new folder |
| `kdrive_delete` | Delete a file or folder (moves to trash) |
| `kdrive_move` | Move a file/folder to a different location |
| `kdrive_rename` | Rename a file or folder |

### Calendar

Requires: `INFOMANIAK_TOKEN`

| Tool | Description |
|------|-------------|
| `calendar_list_calendars` | List all available calendars |
| `calendar_list_events` | List events in a date range (ISO 8601 dates) |
| `calendar_create_event` | Create a new event with optional attendees |
| `calendar_update_event` | Update an existing event |
| `calendar_delete_event` | Delete a calendar event |

### Mail

Requires: `MAIL_USER` + `MAIL_PASSWORD`

| Tool | Description |
|------|-------------|
| `mail_list_folders` | List all mail folders (INBOX, Sent, Drafts, etc.) |
| `mail_list_messages` | List messages in a folder (newest first, paginated) |
| `mail_read_message` | Read full email with headers, body, and attachment list |
| `mail_search` | Search by subject, body, or sender |
| `mail_send` | Send email (plain text/HTML, CC/BCC, reply threading) |
| `mail_move` | Move a message to a different folder |
| `mail_delete` | Delete a message |
| `mail_flag` | Add/remove flags (\\Seen, \\Flagged, \\Answered) |

### Contacts

Requires: `DAV_USER` + `DAV_PASSWORD` (falls back to `MAIL_USER` + `MAIL_PASSWORD`, but Infomaniak usually expects the short DAV username)

| Tool | Description |
|------|-------------|
| `contacts_list_address_books` | List all address books |
| `contacts_list` | List all contacts |
| `contacts_search` | Search contacts by name, email, phone, or org |
| `contacts_get` | Get a specific contact with full details |
| `contacts_create` | Create a new contact (name, email, phone, org) |
| `contacts_update` | Update an existing contact |
| `contacts_delete` | Delete a contact |

### AI Tools (Euria)

Requires: `INFOMANIAK_TOKEN` + `AI_PRODUCT_ID`

| Tool | Description |
|------|-------------|
| `ai_list_models` | List available models (Llama 3, Mistral, DeepSeek, etc.) |
| `ai_chat` | Chat completion — summarize, translate, process text |
| `ai_embeddings` | Generate vector embeddings for semantic search |
| `ai_transcribe` | Transcribe audio to text (Whisper) |

### Swiss Transfer

Requires: `INFOMANIAK_TOKEN` + `ENABLE_EXPERIMENTAL_SWISSTRANSFER=1`

Swiss Transfer is currently **experimental** and **disabled by default**. The live upload flow used by swisstransfer.com has changed, so these tools are hidden unless you explicitly opt in with `ENABLE_EXPERIMENTAL_SWISSTRANSFER=1`.

The current experimental implementation follows the live `/api/containers` + `/api/uploadChunk/*` + `/api/uploadComplete` flow, but it still needs a valid browser-generated reCAPTCHA token from swisstransfer.com for each upload. In practice that means:
- the MCP server cannot fully automate SwissTransfer uploads on its own
- `swisstransfer_send` needs `recaptcha_token` and uses `recaptcha_version` `3`
- that token is short-lived and intended to be generated client-side by the site

Recommended workflow:

```bash
ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 npm start
npm run swisstransfer:helper
```

That script prints:
- a DevTools console snippet for `https://www.swisstransfer.com/`
- a bookmarklet you can save and click on the live site

Use the returned payload immediately:

```json
{
  "recaptcha_token": "<fresh token>",
  "recaptcha_version": 3
}
```

You can also use the same token for the experimental smoke run:

```bash
ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 \
SWISSTRANSFER_RECAPTCHA_TOKEN='<fresh token>' \
npm run smoke:live
```

Avoid storing `SWISSTRANSFER_RECAPTCHA_TOKEN` as a long-lived environment variable. It expires quickly and is mainly useful for an immediate upload or smoke run.

Full workflow: [docs/SWISSTRANSFER_EXPERIMENTAL.md](./docs/SWISSTRANSFER_EXPERIMENTAL.md)

| Tool | Description |
|------|-------------|
| `swisstransfer_send` | Experimental upload via the live `/api` flow. Requires `recaptcha_token`. |
| `swisstransfer_info` | Get transfer status and details, with optional password support |

### kMeet

Requires: `INFOMANIAK_TOKEN`

| Tool | Description |
|------|-------------|
| `kmeet_create_room` | Create a video conference room (returns join URL) |
| `kmeet_list_rooms` | List all conference rooms |
| `kmeet_delete_room` | Delete a conference room |

### Chk (URL Shortener)

Requires: `INFOMANIAK_TOKEN`

| Tool | Description |
|------|-------------|
| `chk_create_short_url` | Create a short URL (custom alias, expiry, QR code) |
| `chk_list_short_urls` | List all your short URLs |
| `chk_delete_short_url` | Delete a short URL |

### kPaste

No credentials required (zero-knowledge encryption).

| Tool | Description |
|------|-------------|
| `kpaste_create` | Create an encrypted paste (AES-256-GCM, auto-expiry, burn-after-reading) |

---

## Use Cases

### Daily email management

**"Summarize my unread emails"**
```
→ mail_list_messages (INBOX, page 1)
→ mail_read_message (for each unread)
→ Claude summarizes all emails
```

**"Find all emails from Acme Corp this month and flag the important ones"**
```
→ mail_search (query: "acme", folder: INBOX)
→ mail_read_message (for each match)
→ mail_flag (add \\Flagged to important ones)
```

**"Reply to John's email about the project update"**
```
→ mail_search (query: "project update from john")
→ mail_read_message (get the Message-ID)
→ mail_send (with reply_to_message_id for proper threading)
```

**"Move all newsletters to the Archive folder"**
```
→ mail_search (query: "unsubscribe", folder: INBOX)
→ mail_move (each message → Archive)
```

### Calendar & scheduling

**"What's on my calendar this week?"**
```
→ calendar_list_events (from: Monday, to: Friday)
→ Claude formats a readable schedule
```

**"Schedule a meeting with Sarah next Tuesday at 2pm"**
```
→ contacts_search (query: "Sarah")
→ calendar_create_event (title, start, end, attendees: [sarah@...])
→ kmeet_create_room (create video link)
→ mail_send (send Sarah the meeting details + join URL)
```

**"Reschedule tomorrow's standup to 10am"**
```
→ calendar_list_events (tomorrow)
→ calendar_update_event (change start/end times)
```

**"Cancel all my meetings on Friday"**
```
→ calendar_list_events (Friday)
→ calendar_delete_event (each event)
→ mail_send (notify attendees)
```

### File management

**"Find the Q4 report in kDrive"**
```
→ kdrive_search (query: "Q4 report")
→ kdrive_get_file (metadata: size, date, path)
```

**"Download the budget spreadsheet and summarize the key figures"**
```
→ kdrive_search (query: "budget")
→ kdrive_download_file (get base64 content)
→ Claude analyzes the spreadsheet
```

**"Upload the meeting notes to the Projects folder"**
```
→ kdrive_search (query: "Projects" to find folder)
→ kdrive_upload_file (folder_id, filename, base64 content)
```

**"Organize the Downloads folder — move images to Photos, docs to Documents"**
```
→ kdrive_list_files (Downloads folder)
→ kdrive_move (each file to appropriate folder based on type)
```

### Cross-service workflows

**"Transcribe yesterday's meeting recording and email it to all attendees"**
```
→ kdrive_search (find the audio file)
→ kdrive_download_file (get the audio as base64)
→ ai_transcribe (Whisper transcription, all on Swiss infra)
→ calendar_list_events (yesterday — get meeting + attendees)
→ mail_send (email transcript to all attendees)
```

**"Share the presentation with the client securely"**
```
→ kdrive_download_file (get the file)
→ swisstransfer_send (experimental: create encrypted transfer with password)
→ chk_create_short_url (shorten the download link)
→ mail_send (email the short link to the client)
```

**"Send the new WiFi password to the team securely"**
```
→ kpaste_create (encrypted paste, burn-after-reading)
→ mail_send (send the one-time URL to the team)
```

**"Prepare for tomorrow's meetings"**
```
→ calendar_list_events (tomorrow)
→ For each meeting:
  → contacts_search (look up attendees)
  → mail_search (find recent emails from them)
  → Claude summarizes context for each meeting
```

### Contact management

**"Find John Smith's phone number"**
```
→ contacts_search (query: "John Smith")
→ Returns phone, email, organization
```

**"Add a new client contact"**
```
→ contacts_create (name, email, phone, organization)
```

**"Update the CEO's email for Acme Corp"**
```
→ contacts_search (query: "Acme")
→ contacts_update (new email)
```

### AI-powered analysis (requires Euria)

**"Summarize this document in French using Swiss AI"**
```
→ kdrive_download_file (get the document)
→ ai_chat (system: "Summarize in French", user: document content)
→ All processing stays in Swiss data centers
```

**"Transcribe the voicemail I just received"**
```
→ kdrive_search (find the audio attachment)
→ kdrive_download_file (get audio)
→ ai_transcribe (Whisper)
```

**"Translate this email to German"**
```
→ mail_read_message (get the email)
→ ai_chat (translate to German)
→ mail_send (forward translated version)
```

### URL shortening & sharing

**"Create a short link for our event page"**
```
→ chk_create_short_url (long URL → short URL + QR code)
```

**"How many clicks did our campaign link get?"**
```
→ chk_list_short_urls
→ Returns click counts and metadata
```

---

## Environment Variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `INFOMANIAK_TOKEN` | kDrive, Calendar, AI, Chk, kMeet, experimental Swiss Transfer | API token from [Infomaniak Manager](https://manager.infomaniak.com/v3/ng/accounts/token) |
| `ENABLE_EXPERIMENTAL_SWISSTRANSFER` | Swiss Transfer | Optional feature flag. Set to `1` to register experimental Swiss Transfer tools. |
| `SWISSTRANSFER_RECAPTCHA_TOKEN` | Swiss Transfer smoke test | Optional. Lets `scripts/live-smoke.mjs` exercise experimental SwissTransfer tools when you already have a fresh browser-generated token. Not meant for long-lived config. |
| `KDRIVE_ID` | kDrive | Numeric drive ID (from kDrive URL) |
| `AI_PRODUCT_ID` | AI Tools | AI Tools product ID from Infomaniak Manager |
| `MAIL_USER` | Mail | Full email address (e.g. `you@ik.me`) |
| `MAIL_PASSWORD` | Mail | Email password or app-specific password |
| `DAV_USER` | Contacts | CardDAV/CalDAV username — your short Infomaniak username (e.g. `AB12345`). Falls back to `MAIL_USER` if not set. |
| `DAV_PASSWORD` | Contacts | CardDAV/CalDAV password — may differ from mail password, especially with 2FA. Falls back to `MAIL_PASSWORD` if not set. |
| `IMAP_HOST` | — | Override IMAP host (default: `mail.infomaniak.com`) |
| `IMAP_PORT` | — | Override IMAP port (default: `993`) |
| `SMTP_HOST` | — | Override SMTP host (default: `mail.infomaniak.com`) |
| `SMTP_PORT` | — | Override SMTP port (default: `587`) |
| `CARDDAV_URL` | — | Override CardDAV server (default: `https://sync.infomaniak.com`) |
| `CALDAV_URL` | — | Override CalDAV server (default: `https://sync.infomaniak.com`) |

> **CardDAV/CalDAV vs IMAP credentials**: Infomaniak uses **separate authentication** for sync protocols. CardDAV/CalDAV requires your short username (e.g. `abc12345`), while IMAP uses your full email address. If you have 2FA enabled, you **must** generate an app password at [manager.infomaniak.com](https://manager.infomaniak.com/v3/profile/application-password) for DAV access. If `DAV_USER`/`DAV_PASSWORD` are not set, they fall back to `MAIL_USER`/`MAIL_PASSWORD` (which likely won't work unless your email username happens to match).

**Graceful degradation**: Each service is enabled independently based on its credentials. You can have mail without contacts, contacts without mail, etc.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│              AI Client                       │
│  (Claude Code / Claude Desktop / Codex)      │
└──────────────┬───────────────────────────────┘
               │ stdio (stdin/stdout)
┌──────────────▼───────────────────────────────┐
│         MCP Server (this project)            │
│                                              │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ kDrive  │ │ Calendar │ │ AI (Euria)    │ │
│  │ REST API│ │ REST API │ │ REST API      │ │
│  └─────────┘ └──────────┘ └───────────────┘ │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐ │
│  │  Mail   │ │ Contacts │ │ Swiss Transfer│ │
│  │IMAP/SMTP│ │ CardDAV  │ │ REST API      │ │
│  └─────────┘ └──────────┘ └───────────────┘ │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐ │
│  │  kMeet  │ │   Chk    │ │    kPaste     │ │
│  │ REST API│ │ REST API │ │  PrivateBin   │ │
│  └─────────┘ └──────────┘ └───────────────┘ │
└──────────────────────────────────────────────┘
               │         │         │
    ┌──────────┘         │         └──────────┐
    ▼                    ▼                    ▼
api.infomaniak.com  mail.infomaniak.com  sync.infomaniak.com
  (REST API)          (IMAP/SMTP)          (CardDAV)
```

### How it works

1. Your AI client (Claude, Cursor, etc.) starts the MCP server as a local subprocess
2. The server communicates over stdio (stdin/stdout) — no HTTP, no ports
3. The AI discovers available tools and calls them as needed
4. Each tool talks to the appropriate Infomaniak service
5. Results flow back to the AI, which processes and presents them

### Protocols used

| Service | Protocol | Why |
|---------|----------|-----|
| kDrive, Calendar, AI, Chk, kMeet | Infomaniak REST API | Official API available |
| Mail | IMAP (read) / SMTP (send) | No message-level REST API exists |
| Contacts | CardDAV | No contacts REST API exists |
| Swiss Transfer | Swiss Transfer API | Dedicated transfer API (experimental) |
| kPaste | PrivateBin protocol | Zero-knowledge encrypted — must encrypt client-side |

---

## Security & Privacy

- **Local execution**: The server runs on your machine. No remote hosting, no cloud deployment needed.
- **Credentials stay local**: Environment variables are read at startup, never transmitted beyond the target APIs.
- **Zero-knowledge (kPaste)**: Content is AES-256-GCM encrypted locally. The server never sees plaintext. The decryption key only exists in the URL fragment.
- **Swiss data sovereignty**: All Infomaniak services (including Euria AI) process data exclusively in Swiss data centers, compliant with Swiss Federal Data Protection Act (nFADP).
- **No telemetry**: This server sends no analytics or usage data anywhere.

---

## Known Limitations

- **Swiss Transfer**: Disabled by default. The experimental implementation now matches the live `/api` flow, but uploads still depend on a valid short-lived browser-generated reCAPTCHA token.
- **kMeet / Chk**: API endpoints are inferred from patterns — test with your account
- **Calendar update/delete**: These endpoints are not in official docs but match the pattern used by Infomaniak's own tools
- **Large files**: Downloads >50MB are blocked to prevent MCP protocol issues. Use kDrive web for large files.
- **Mobile**: MCP servers only work with desktop AI clients, not mobile apps
- **IMAP**: Each mail operation opens a new connection. This is reliable but not optimized for rapid sequential operations.
- **Mail smoke test**: The live smoke's "sent copy" check depends on your Sent folder updating quickly, so that specific verification can occasionally skip even when mail sending itself works.

---

## Disclaimer

This project is **not affiliated with, endorsed by, or officially supported by Infomaniak Network SA**. "Infomaniak", "kSuite", "kDrive", "kMeet", "kPaste", "Chk", "Swiss Transfer", and "Euria" are trademarks of [Infomaniak Network SA](https://www.infomaniak.com/).

This is an independent, community-built integration that uses Infomaniak's public APIs and standard protocols (IMAP, SMTP, CardDAV). Use of Infomaniak services is subject to their [Terms of Service](https://www.infomaniak.com/en/legal/general-terms-and-conditions).

## Acknowledgements

- **[Infomaniak](https://github.com/Infomaniak)** — for their official [mcp-server-kdrive](https://github.com/Infomaniak/mcp-server-kdrive), [mcp-server-calendar](https://github.com/Infomaniak/mcp-server-calendar), and [mcp-server-kchat](https://github.com/Infomaniak/mcp-server-kchat) (all MIT licensed), which informed the API patterns used here
- **[PrivateBin](https://privatebin.info/)** — kPaste implements the [PrivateBin v2 protocol](https://github.com/PrivateBin/PrivateBin/wiki/API) (zlib + AES-256-GCM + PBKDF2) for zero-knowledge encrypted pastes
- **[Model Context Protocol](https://modelcontextprotocol.io/)** — open standard by Anthropic for connecting AI to tools

### Key dependencies

| Package | License | Purpose |
|---------|---------|---------|
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP server framework |
| [imapflow](https://github.com/postalsys/imapflow) | MIT | IMAP client |
| [nodemailer](https://github.com/nodemailer/nodemailer) | MIT | SMTP client |
| [mailparser](https://github.com/nodemailer/mailparser) | MIT | Email parsing |
| [tsdav](https://github.com/natelindev/tsdav) | MIT | CardDAV/CalDAV client |
| [zod](https://github.com/colinhacks/zod) | MIT | Schema validation |

## License

MIT — see [LICENSE](LICENSE) for details.
