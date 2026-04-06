# Infomaniak kSuite MCP Server

A unified [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives AI agents full access to your Infomaniak kSuite ecosystem. One server, one config — 38 tools across 8 services.

## Services

| Service | Protocol | Tools | Description |
|---------|----------|-------|-------------|
| **kDrive** | REST API | 8 | Cloud storage — search, browse, download, create, move, rename, delete files |
| **Calendar** | REST API | 5 | Calendar management — list, create, update, delete events |
| **Mail** | IMAP/SMTP | 8 | Email — read, search, send, move, delete, flag messages |
| **Contacts** | CardDAV | 6 | Address book — list, get, create, update, delete contacts |
| **AI Tools (Euria)** | REST API | 4 | Sovereign Swiss AI — chat, embeddings, audio transcription |
| **Swiss Transfer** | REST API | 2 | Encrypted file sharing up to 50 GB |
| **kMeet** | REST API | 3 | Video conferencing room management |
| **Chk** | REST API | 3 | URL shortener with QR codes |
| **kPaste** | PrivateBin | 1 | Zero-knowledge encrypted secret sharing |

## Quick Start

### 1. Install & build

```bash
git clone https://github.com/your-org/infomaniak-mcp.git
cd infomaniak-mcp
npm install
npm run build
```

### 2. Get your credentials

#### Infomaniak API token

1. Go to [Infomaniak Token Manager](https://manager.infomaniak.com/v3/ng/accounts/token)
2. Create a token with the scopes you need:
   - `drive` — for kDrive
   - `workspace:calendar` — for Calendar
   - `user_info` — for Calendar (timezone/profile)
   - Additional scopes as needed for kMeet, Chk, etc.

#### kDrive ID

Open your kDrive in the browser. The numeric ID is in the URL:
`https://kdrive.infomaniak.com/app/drive/XXXXX/files` → `XXXXX` is your drive ID.

#### AI Tools product ID

If you have an AI Tools subscription, find the product ID in the Infomaniak manager under AI Tools settings.

#### Mail credentials

Your full Infomaniak email address and password. If you have 2FA enabled, create an app-specific password in your Infomaniak account settings.

### 3. Configure your AI client

#### Claude Code

Add to `~/.claude/settings.json`:

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
        "MAIL_PASSWORD": "your-password"
      }
    }
  }
}
```

#### Claude Desktop

Add to your `claude_desktop_config.json`:

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
        "MAIL_PASSWORD": "your-password"
      }
    }
  }
}
```

#### Cursor / Other MCP clients

Most MCP clients follow a similar JSON configuration format. Refer to your client's docs for the config file location.

---

## All Tools

### kDrive

Requires: `INFOMANIAK_TOKEN` + `KDRIVE_ID`

| Tool | Description |
|------|-------------|
| `kdrive_search` | Search files by name or content |
| `kdrive_list_files` | List files in a folder (omit folder_id for root) |
| `kdrive_get_file` | Get metadata for a specific file |
| `kdrive_download_file` | Download file content (returns base64) |
| `kdrive_create_folder` | Create a new folder |
| `kdrive_delete` | Delete a file or folder |
| `kdrive_move` | Move a file/folder to a different location |
| `kdrive_rename` | Rename a file or folder |

### Calendar

Requires: `INFOMANIAK_TOKEN`

| Tool | Description |
|------|-------------|
| `calendar_list_calendars` | List all available calendars |
| `calendar_list_events` | List events in a date range (ISO 8601 dates) |
| `calendar_create_event` | Create a new event with optional attendees |
| `calendar_update_event` | Update an existing event's title, time, or description |
| `calendar_delete_event` | Delete a calendar event |

### Mail

Requires: `MAIL_USER` + `MAIL_PASSWORD`

| Tool | Description |
|------|-------------|
| `mail_list_folders` | List all mail folders (INBOX, Sent, Drafts, etc.) |
| `mail_list_messages` | List messages in a folder (newest first, paginated) |
| `mail_read_message` | Read full email content by UID |
| `mail_search` | Search messages by subject, body, or sender |
| `mail_send` | Send an email (plain text and/or HTML, with CC/BCC) |
| `mail_move` | Move a message to a different folder |
| `mail_delete` | Delete a message |
| `mail_flag` | Add/remove flags (\\Seen, \\Flagged, \\Answered, etc.) |

### Contacts

Requires: `MAIL_USER` + `MAIL_PASSWORD`

| Tool | Description |
|------|-------------|
| `contacts_list_address_books` | List all address books |
| `contacts_list` | List all contacts (optionally filtered by address book) |
| `contacts_get` | Get a specific contact with full vCard details |
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
| `ai_transcribe` | Transcribe audio to text (Whisper) — works with kDrive files |

### Swiss Transfer

Requires: `INFOMANIAK_TOKEN`

| Tool | Description |
|------|-------------|
| `swisstransfer_send` | Send files (up to 50 GB) with encryption, expiration, password |
| `swisstransfer_info` | Get info about a transfer |

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
| `chk_create_short_url` | Create a short URL (with optional QR code, custom alias, expiry) |
| `chk_list_short_urls` | List all your short URLs |
| `chk_delete_short_url` | Delete a short URL |

### kPaste

No credentials required (zero-knowledge encryption).

| Tool | Description |
|------|-------------|
| `kpaste_create` | Create an encrypted ephemeral paste (AES-256-GCM, auto-expiry, burn-after-reading) |

---

## Environment Variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `INFOMANIAK_TOKEN` | kDrive, Calendar, AI, Chk, kMeet, Swiss Transfer | API token from [Infomaniak Manager](https://manager.infomaniak.com/v3/ng/accounts/token) |
| `KDRIVE_ID` | kDrive | Numeric drive ID (from kDrive URL) |
| `AI_PRODUCT_ID` | AI Tools | AI Tools product ID from Infomaniak Manager |
| `MAIL_USER` | Mail, Contacts | Full email address (e.g. `you@ik.me`) |
| `MAIL_PASSWORD` | Mail, Contacts | Email password or app-specific password |
| `IMAP_HOST` | — | Override IMAP host (default: `mail.infomaniak.com`) |
| `IMAP_PORT` | — | Override IMAP port (default: `993`) |
| `SMTP_HOST` | — | Override SMTP host (default: `mail.infomaniak.com`) |
| `SMTP_PORT` | — | Override SMTP port (default: `587`) |
| `CARDDAV_URL` | — | Override CardDAV server (default: `https://sync.infomaniak.com`) |

**Graceful degradation**: The server only enables tools for services where credentials are provided. If you only set `MAIL_USER` + `MAIL_PASSWORD`, you'll get mail + contacts but no kDrive/calendar/AI. This means you can start with just the services you need.

---

## Example Workflows

### "Summarize my unread emails"
```
1. mail_list_messages (INBOX, unread)
2. mail_read_message (for each)
3. AI summarizes the content
```

### "Transcribe the recording from today's meeting and email the summary to attendees"
```
1. kdrive_search → find the audio file
2. kdrive_download_file → get the audio (base64)
3. ai_transcribe → Whisper transcription on Swiss infrastructure
4. calendar_list_events → get today's meeting + attendees
5. mail_send → email the transcript to all attendees
```

### "Share this document securely with a client"
```
1. kdrive_download_file → get the file
2. swisstransfer_send → create encrypted transfer link
3. chk_create_short_url → shorten the link
4. mail_send → email the short link to the client
```

### "Set up a meeting with John next Tuesday"
```
1. contacts_list → find John's email
2. calendar_create_event → create the event with John as attendee
3. kmeet_create_room → create a video conference room
4. mail_send → send John the meeting details + join link
```

### "Share a password with a colleague securely"
```
1. kpaste_create → encrypted paste with burn-after-reading
2. mail_send → email the one-time URL
```

---

## Architecture

```
┌──────────────────────────────────────────────┐
│              AI Client                       │
│  (Claude Code / Claude Desktop / Cursor)     │
└──────────────┬───────────────────────────────┘
               │ stdio (stdin/stdout)
               │
┌──────────────▼───────────────────────────────┐
│         MCP Server (this project)            │
│                                              │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ kDrive  │ │ Calendar │ │ AI (Euria)    │ │
│  │ REST API│ │ REST API │ │ REST API      │ │
│  └────┬────┘ └────┬─────┘ └───────┬───────┘ │
│  ┌────┴────┐ ┌────┴─────┐ ┌───────┴───────┐ │
│  │  Mail   │ │ Contacts │ │ Swiss Transfer│ │
│  │IMAP/SMTP│ │ CardDAV  │ │ REST API      │ │
│  └─────────┘ └──────────┘ └───────────────┘ │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐ │
│  │  kMeet  │ │   Chk    │ │    kPaste     │ │
│  │ REST API│ │ REST API │ │  PrivateBin   │ │
│  └─────────┘ └──────────┘ └───────────────┘ │
└──────────────────────────────────────────────┘
```

- All REST API calls go to `api.infomaniak.com` with Bearer token auth
- IMAP/SMTP connects to `mail.infomaniak.com` with user/pass
- CardDAV connects to `sync.infomaniak.com` with user/pass
- kPaste uses client-side AES-256-GCM encryption (zero-knowledge)
- The server runs locally as a subprocess — your credentials never leave your machine

---

## Security

- **Local execution**: The server runs on your machine as a subprocess. No remote hosting.
- **Credentials stay local**: Environment variables are read at startup, never transmitted beyond the target APIs.
- **Zero-knowledge (kPaste)**: Encryption happens locally; the server never sees plaintext.
- **Swiss data sovereignty**: All Infomaniak services (including Euria AI) process data in Swiss data centers.

## License

MIT
