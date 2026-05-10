# Infomaniak kSuite MCP Server

A unified [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives AI agents full access to your Infomaniak kSuite ecosystem. One server, one config — stable tools for kDrive, Calendar, Mail, Contacts, kChat, kMeet, Chk, and kPaste, plus optional AI tools and experimental Swiss Transfer support.

All data stays on Swiss infrastructure. Your credentials never leave your machine.

## Services

| Service | Protocol | Tools | Description |
|---------|----------|-------|-------------|
| **kDrive** | REST API | 25 | Cloud storage — files plus share links, versions, trash restore, comments, recents, and activity |
| **Calendar** | REST API | 5 | Calendar management — list, create, update, delete events |
| **Tasks** | CalDAV | 8 | Task management — list, search, view, create, update, complete, delete VTODO tasks |
| **Mail** | Mail API + IMAP/SMTP fallback | 10 | Email — list mailboxes, read, search, send, download attachments, move, delete, flag messages |
| **Contacts** | CardDAV | 7 | Address book — list, search, get, create, update, delete contacts |
| **AI Tools (Euria)** | REST API | 4 | Sovereign Swiss AI — chat, embeddings, audio transcription |
| **Swiss Transfer** | REST API | 2 experimental | Encrypted file sharing up to 50 GB (disabled by default) |
| **kChat** | REST API | 9 | Team chat — channels, posts, threads, reactions, users, and direct messages |
| **kMeet** | REST API | 3 | Video conferencing room management |
| **Chk** | REST API | 3 | URL shortener with QR codes |
| **kPaste** | PrivateBin | 1 | Zero-knowledge encrypted secret sharing |

## Capability Matrix

| Service | Read | Write | Notes |
|---------|------|-------|-------|
| kDrive | Yes | Yes | Files plus share links, versions, trash restore, comments, recents, and activity |
| Calendar | Yes | Yes | Event CRUD via Infomaniak REST API |
| Tasks | Yes | Yes | VTODO CRUD via CalDAV |
| Mail | Yes | Yes | API-backed list/read/send when `MAIL_TOKEN` or `INFOMANIAK_TOKEN` has `workspace:mail`; IMAP/SMTP fallback covers search, attachments, move, delete, and flag |
| Contacts | Yes | Yes | Contact CRUD via CardDAV |
| AI Tools (Euria) | N/A | N/A | Stateless model calls: chat, embeddings, transcription |
| Swiss Transfer | Partial | Partial | Experimental and disabled by default; send/info only |
| kChat | Yes | Yes | Channel history, thread replies, posting, reactions, users, and DMs |
| kMeet | Limited | Yes | Create/schedule rooms; no list/update/delete room tools yet |
| Chk | Yes | Yes | List/create/delete short URLs |
| kPaste | No | Yes | Create encrypted pastes only; read/decrypt is not implemented yet |

## Backend & Protocol Matrix

| Area | Backend / protocol | Host | Auth | Used for |
|------|--------------------|------|------|----------|
| kDrive | Infomaniak REST API | `api.infomaniak.com` | Bearer `INFOMANIAK_TOKEN` + `KDRIVE_ID` | File operations, share links, versions, trash restore, comments, recents, activity |
| Calendar | Infomaniak REST API | `api.infomaniak.com` | Bearer `INFOMANIAK_TOKEN` | Calendar list and event CRUD |
| Mail API | Infomaniak Mail API | `mail.infomaniak.com/api` | Bearer `MAIL_TOKEN` with `workspace:mail` scope, or `INFOMANIAK_TOKEN` fallback | Mailboxes, folders, message list, message read, plain send |
| Mail fallback | IMAP + SMTP | `mail.infomaniak.com` | `MAIL_USER` + `MAIL_PASSWORD` | Search, attachment download/sending, move, delete, flag, reply threading |
| Contacts | CardDAV | `sync.infomaniak.com` | Basic auth with `DAV_USER` + `DAV_PASSWORD` | Address book and contact CRUD |
| Tasks | CalDAV VTODO | `sync.infomaniak.com` | Basic auth with `DAV_USER` + `DAV_PASSWORD` | Task list, search, view, create, update, complete/reopen, delete |
| AI Tools (Euria) | OpenAI-compatible REST API | Infomaniak AI endpoint | Bearer `INFOMANIAK_TOKEN` + `AI_PRODUCT_ID` | Chat, embeddings, transcription |
| Swiss Transfer | Swiss Transfer REST flow | `www.swisstransfer.com` | `INFOMANIAK_TOKEN` plus short-lived reCAPTCHA token | Experimental transfer creation/info |
| kChat | kChat REST API | `{team}.kchat.infomaniak.com` | Bearer `KCHAT_TOKEN` + `KCHAT_TEAM_NAME` | Channels, posts, threads, reactions, users, DMs |
| kMeet | Infomaniak REST API | `api.infomaniak.com` | Bearer `INFOMANIAK_TOKEN` | Room creation, scheduling, and room settings |
| Chk | Infomaniak REST API | `api.infomaniak.com` | Bearer `INFOMANIAK_TOKEN` | Short URL create/list/delete |
| kPaste | PrivateBin v2 protocol | `kpaste.infomaniak.com` | No account auth; client-side encryption key stays in URL fragment | Encrypted paste creation |

### Mail Backend Split

| Mail operation | Backend used |
|----------------|--------------|
| `mail_list_mailboxes` | Mail API only |
| `mail_list_folders` | Mail API first, IMAP fallback |
| `mail_list_messages` | Mail API first, IMAP fallback |
| `mail_read_message` | Mail API first, IMAP fallback |
| `mail_send` without attachments | Mail API first, SMTP fallback |
| `mail_send` with attachments | SMTP fallback |
| `mail_search` | IMAP fallback |
| `mail_download_attachment` | IMAP fallback |
| `mail_move` / `mail_delete` / `mail_flag` | IMAP fallback |

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

**Infomaniak API token** (for kDrive, Calendar, Mail API, AI, Chk, kMeet, and experimental Swiss Transfer):
1. Go to [Infomaniak Token Manager](https://manager.infomaniak.com/v3/ng/accounts/token)
2. Create a token with scopes for the services you need, such as `drive`, `workspace:calendar`, `workspace:mail`, and `user_info`

**kDrive ID**: Open your kDrive in the browser — the numeric ID is in the URL:
`https://kdrive.infomaniak.com/app/drive/XXXXX/files` → `XXXXX` is your drive ID.

**AI Tools product ID** (optional): If you have an AI Tools subscription, find the product ID in the Infomaniak Manager under AI Tools.

**Mail API token**: Set `MAIL_TOKEN` to a token with `workspace:mail` scope. If `MAIL_TOKEN` is omitted, the server tries `INFOMANIAK_TOKEN` for Mail API calls too.

**Mail IMAP/SMTP credentials**: Optional but recommended for the full mail tool set. Set your full Infomaniak email address and password. If you have 2FA enabled, create an app-specific password. These credentials are used for search, attachment download/sending, move, delete, and flag operations while the Mail API support catches up.

**kChat credentials** (optional): Set `KCHAT_TOKEN` to a token with kChat access and `KCHAT_TEAM_NAME` to the team subdomain from your kChat URL, e.g. `https://your-team.kchat.infomaniak.com/...` → `your-team`.

**CardDAV/CalDAV credentials** (for Contacts and Tasks):
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
        "MAIL_TOKEN": "your-mail-api-token",
        "KDRIVE_ID": "123456",
        "AI_PRODUCT_ID": "789",
        "MAIL_USER": "you@ik.me",
        "MAIL_PASSWORD": "your-password",
        "DAV_USER": "AB12345",
        "DAV_PASSWORD": "your-dav-password",
        "KCHAT_TOKEN": "your-kchat-token",
        "KCHAT_TEAM_NAME": "your-team"
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
        "MAIL_TOKEN": "your-mail-api-token",
        "KDRIVE_ID": "123456",
        "AI_PRODUCT_ID": "789",
        "MAIL_USER": "you@ik.me",
        "MAIL_PASSWORD": "your-password",
        "DAV_USER": "AB12345",
        "DAV_PASSWORD": "your-dav-password",
        "KCHAT_TOKEN": "your-kchat-token",
        "KCHAT_TEAM_NAME": "your-team"
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
  --env KCHAT_TOKEN=your-kchat-token \
  --env KCHAT_TEAM_NAME=your-team \
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
MAIL_TOKEN = "your-mail-api-token"
KDRIVE_ID = "123456"
AI_PRODUCT_ID = "789"
MAIL_USER = "you@ik.me"
MAIL_PASSWORD = "your-password"
DAV_USER = "AB12345"
DAV_PASSWORD = "your-dav-password"
KCHAT_TOKEN = "your-kchat-token"
KCHAT_TEAM_NAME = "your-team"
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
npm run smoke:readonly
npm run smoke:write-owned
npm run smoke:live
```

What to expect from the read-only smoke:
- starts the MCP server over stdio and calls tools through the MCP protocol
- loads normal environment variables, or set `SMOKE_CODEX_SERVER=infomaniak` to reuse `~/.codex/config.toml`
- exercises no-delete checks for tool registration, kDrive, Calendar, Mail API, Contacts, Tasks, Chk, and optional AI/kChat when configured
- set `SMOKE_SEND_SELF=1 SMOKE_SELF_EMAIL=henrik@ogard.no` to send exactly one plain test email to yourself

What to expect from the owned write smoke:
- creates only clearly named `MCP Smoke Owned ...` test data, then edits and deletes only the IDs/URLs it created during the same run
- covers owned write paths for kDrive, Calendar, Tasks, Contacts, Chk, and one self-email to `henrik@ogard.no`
- refuses to send mail anywhere except `henrik@ogard.no`

What to expect from the full live smoke:
- enabled services are exercised against your real credentials
- it creates temporary artifacts and then deletes/moves cleanup targets, so use `smoke:readonly` when you want a no-delete test run
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
| `kdrive_get_share_link` | Get a file/folder share-link configuration |
| `kdrive_create_share_link` | Create a public share link with optional permissions, password, and expiry |
| `kdrive_update_share_link` | Update share-link permissions, password, or expiry |
| `kdrive_delete_share_link` | Remove a share link |
| `kdrive_list_share_links` | List files/folders that currently have share links |
| `kdrive_list_versions` | List saved versions for a file |
| `kdrive_restore_version` | Restore a previous version in place |
| `kdrive_restore_version_to_folder` | Restore a previous version as a copy in another folder |
| `kdrive_list_trash` | List files and folders in trash |
| `kdrive_restore_from_trash` | Restore a trashed file or folder |
| `kdrive_list_comments` | List comments on a file |
| `kdrive_add_comment` | Add a comment to a file |
| `kdrive_reply_comment` | Reply to an existing file comment |
| `kdrive_delete_comment` | Delete a file comment |
| `kdrive_list_file_activities` | List activity for a file or folder |
| `kdrive_list_recents` | List recently used files and folders |

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

Requires: `MAIL_TOKEN` with `workspace:mail` scope for API-backed mailbox/folder/message list, read, and plain send. Also set `MAIL_USER` + `MAIL_PASSWORD` to enable IMAP/SMTP fallback tools for search, attachment download/sending, move, delete, and flag.

| Tool | Description |
|------|-------------|
| `mail_list_mailboxes` | List mailboxes available to the Mail API token |
| `mail_list_folders` | List all mail folders (INBOX, Sent, Drafts, etc.) |
| `mail_list_messages` | List messages in a folder (newest first, paginated) |
| `mail_read_message` | Read full email with headers, body, and attachment list |
| `mail_download_attachment` | Download a specific attachment from a message as base64 |
| `mail_search` | Search by subject, body, or sender |
| `mail_send` | Send email with plain text/HTML, attachments, CC/BCC, and reply threading |
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

### Tasks

Requires: `DAV_USER` + `DAV_PASSWORD` (falls back to `MAIL_USER` + `MAIL_PASSWORD`, but Infomaniak usually expects the short DAV username)

| Tool | Description |
|------|-------------|
| `tasks_list_calendars` | List CalDAV calendars that can contain tasks |
| `tasks_list` | List tasks, optionally filtered by calendar and completion state |
| `tasks_search` | Search tasks by title, description, status, calendar, or category |
| `tasks_get` | View one task by task ID, UID, or CalDAV object URL |
| `tasks_create` | Create a task with title, description, due date, priority, and categories |
| `tasks_update` | Update task title, description, due date, priority, categories, or status |
| `tasks_complete` | Mark a task completed or reopen it |
| `tasks_delete` | Delete a task |

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
| `kmeet_create_room` | Create an instant video conference room (returns join URL) |
| `kmeet_schedule_room` | Create a scheduled kMeet room tied to a calendar event, with optional attendees and room settings |
| `kmeet_get_room_settings` | Fetch settings for an existing scheduled kMeet room |

### kChat

Requires: `KCHAT_TOKEN` + `KCHAT_TEAM_NAME`

| Tool | Description |
|------|-------------|
| `kchat_list_channels` | List public channels in the configured kChat team |
| `kchat_post_message` | Post a message to a channel |
| `kchat_reply_to_thread` | Reply to a message thread |
| `kchat_add_reaction` | Add an emoji reaction to a post |
| `kchat_get_channel_history` | Get recent posts from a channel |
| `kchat_get_thread_replies` | Get replies in a thread |
| `kchat_get_users` | List kChat users |
| `kchat_get_user_profile` | Get a user profile by ID |
| `kchat_send_direct_message` | Send a direct message by username |

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
→ mail_list_mailboxes {}
→ mail_list_folders {"mailbox_uuid": "<mailbox uuid>"}
→ mail_list_messages {"folder": "INBOX", "mailbox_uuid": "<mailbox uuid>", "limit": 20, "page": 1}
→ mail_read_message {"folder": "INBOX", "uid": "<message uid>", "mailbox_uuid": "<mailbox uuid>"}
→ Claude summarizes all emails
```

**"Find all emails from Acme Corp this month and flag the important ones"**
```
→ mail_search {"folder": "INBOX", "query": "acme", "limit": 20}
→ mail_read_message {"folder": "INBOX", "uid": "<matching uid>"}
→ mail_flag {"folder": "INBOX", "uid": "<matching uid>", "flags": ["\\Flagged"], "action": "add"}
```

**"Reply to John's email about the project update"**
```
→ mail_search {"folder": "INBOX", "query": "project update from john"}
→ mail_read_message {"folder": "INBOX", "uid": "<matching uid>"}
→ mail_send {"to": ["john@example.com"], "subject": "Re: Project update", "text": "...", "reply_to_message_id": "<Message-ID>"}
```

**"Move all newsletters to the Archive folder"**
```
→ mail_search {"folder": "INBOX", "query": "unsubscribe", "limit": 50}
→ mail_move {"folder": "INBOX", "uid": "<newsletter uid>", "destination": "Archive"}
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

### Tasks

**"What tasks do I have open?"**
```
→ tasks_list {"status": "open"}
→ Claude formats the active task list
```

**"Find my roadmap tasks"**
```
→ tasks_search {"query": "roadmap", "status": "all"}
→ tasks_get {"task_id": "<task id>"}
```

**"Add a task to prepare the board report by Friday"**
```
→ tasks_list_calendars {}
→ tasks_create {
  "title": "Prepare the board report",
  "due": "2026-05-15T17:00:00+02:00",
  "description": "Draft, review, and attach the final numbers.",
  "categories": ["work", "board"]
}
```

**"Mark the roadmap task done"**
```
→ tasks_search {"query": "roadmap", "status": "open"}
→ tasks_complete {"task_id": "<task id>", "completed": true}
```

**"Move a task due date and add a category"**
```
→ tasks_search {"query": "board report", "status": "open"}
→ tasks_update {
  "task_id": "<task id>",
  "due": "2026-05-18T09:00:00+02:00",
  "categories": ["work", "board", "finance"]
}
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
| `INFOMANIAK_TOKEN` | kDrive, Calendar, Mail API fallback token, AI, Chk, kMeet, experimental Swiss Transfer | API token from [Infomaniak Manager](https://manager.infomaniak.com/v3/ng/accounts/token) |
| `MAIL_TOKEN` | Mail API | Optional dedicated Mail API token with `workspace:mail` scope. If omitted, Mail API calls use `INFOMANIAK_TOKEN`. |
| `ENABLE_EXPERIMENTAL_SWISSTRANSFER` | Swiss Transfer | Optional feature flag. Set to `1` to register experimental Swiss Transfer tools. |
| `SWISSTRANSFER_RECAPTCHA_TOKEN` | Swiss Transfer smoke test | Optional. Lets `scripts/live-smoke.mjs` exercise experimental SwissTransfer tools when you already have a fresh browser-generated token. Not meant for long-lived config. |
| `KDRIVE_ID` | kDrive | Numeric drive ID (from kDrive URL) |
| `KCHAT_TOKEN` | kChat | kChat API token, either user-linked or bot-linked |
| `KCHAT_TEAM_NAME` | kChat | kChat team subdomain, e.g. `your-team` from `https://your-team.kchat.infomaniak.com/` |
| `AI_PRODUCT_ID` | AI Tools | AI Tools product ID from Infomaniak Manager |
| `MAIL_USER` | Mail IMAP/SMTP fallback | Full email address (e.g. `you@ik.me`) |
| `MAIL_PASSWORD` | Mail IMAP/SMTP fallback | Email password or app-specific password |
| `DAV_USER` | Contacts, Tasks | CardDAV/CalDAV username — your short Infomaniak username (e.g. `AB12345`). Falls back to `MAIL_USER` if not set. |
| `DAV_PASSWORD` | Contacts, Tasks | CardDAV/CalDAV password — may differ from mail password, especially with 2FA. Falls back to `MAIL_PASSWORD` if not set. |
| `IMAP_HOST` | — | Override IMAP host (default: `mail.infomaniak.com`) |
| `IMAP_PORT` | — | Override IMAP port (default: `993`) |
| `SMTP_HOST` | — | Override SMTP host (default: `mail.infomaniak.com`) |
| `SMTP_PORT` | — | Override SMTP port (default: `587`) |
| `CARDDAV_URL` | — | Override CardDAV server (default: `https://sync.infomaniak.com`) |
| `CALDAV_URL` | — | Override CalDAV server (default: `https://sync.infomaniak.com`) |

> **Mail API vs IMAP/SMTP**: The Mail API is preferred for fast mailbox/folder/message list, read, and plain send. IMAP/SMTP remains useful for search, attachments, move/delete/flag, and attachment sending.

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
│  │API+IMAP │ │ CardDAV  │ │ REST API      │ │
│  └─────────┘ └──────────┘ └───────────────┘ │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐ │
│  │  Tasks  │ │  kMeet   │ │      Chk      │ │
│  │ CalDAV  │ │ REST API │ │ REST API      │ │
│  └─────────┘ └──────────┘ └───────────────┘ │
│  ┌─────────┐              ┌───────────────┐ │
│  │ kChat   │              │    kPaste     │ │
│  │ REST API│              │  PrivateBin   │ │
│  └─────────┘              └───────────────┘ │
└──────────────────────────────────────────────┘
               │         │         │
    ┌──────────┘         │         └──────────┐
    ▼                    ▼                    ▼
api.infomaniak.com  mail.infomaniak.com  sync.infomaniak.com
  (REST API)        (Mail API/IMAP/SMTP) (CardDAV/CalDAV)
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
| Mail | Infomaniak Mail API + IMAP/SMTP fallback | API covers mailbox/folder/message list, read, and plain send; fallback fills current API gaps |
| Contacts | CardDAV | No contacts REST API exists |
| Tasks | CalDAV | Tasks are exposed as standard iCalendar VTODO objects |
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
- **Mail API coverage**: API-backed mail currently covers mailbox/folder/message listing, reading, and plain sending. Search, attachment download/sending, move, delete, and flag still use IMAP/SMTP fallback.
- **IMAP fallback**: Each fallback mail operation opens a new connection. This is reliable but not optimized for rapid sequential operations.
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
