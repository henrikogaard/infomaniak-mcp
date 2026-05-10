# Changelog

## Unreleased

## [0.2.0] - 2026-05-10

### Added
- Tasks: new CalDAV/VTODO tools for listing task-capable calendars, listing, searching, viewing, creating, updating, completing/reopening, and deleting tasks
- Mail: added an Infomaniak Mail API backend using bearer-token auth, with `mail_list_mailboxes` and API-backed folder/message list, read, and plain send
- Mail: added a hybrid router that prefers the Mail API and falls back to IMAP/SMTP for search, attachments, move, delete, flag, and attachment sending
- kDrive: added share-link management, version restore, trash restore, comments, recents, and file activity tools
- kChat: added tools for channels, posts, threads, reactions, users, and direct messages via `KCHAT_TOKEN` + `KCHAT_TEAM_NAME`
- kMeet: added `kmeet_get_room_settings`
- Tests: added a lightweight Node test harness for CalDAV task parsing, Mail API/hybrid routing, kDrive API routing, kChat API routing, and kMeet room settings

## [0.1.1] - 2026-04-07

### Added
- Mail: `mail_send` now supports file attachments via base64 payloads
- Mail: new `mail_download_attachment` tool for retrieving a specific attachment as base64
- kMeet: `kmeet_schedule_room` now exposes advanced room options such as lobby, password, recording, and audio-only mode

### Changed
- Mail: `mail_read_message` now numbers attachments so they can be downloaded reliably by index
- README: corrected the documented kMeet tool surface to match the actual implementation

## [0.1.0] - 2026-04-06

### Initial release — 41 tools across 9 Infomaniak services

#### Services added
- **kDrive** (9 tools) — search, list, get, download, upload, create folder, delete, move, rename
- **Calendar** (5 tools) — list calendars, list/create/update/delete events
- **Mail** (8 tools) — list folders, list/read/search/send/move/delete messages, flag management
- **Contacts** (7 tools) — list address books, list/search/get/create/update/delete contacts
- **AI Tools / Euria** (4 tools) — list models, chat completion, embeddings, audio transcription (Whisper)
- **Swiss Transfer** (2 tools) — send files (multi-step upload), get transfer info
- **kMeet** (2 tools) — create instant rooms and schedule meetings
- **Chk** (3 tools) — create/list/delete short URLs
- **kPaste** (1 tool) — create encrypted ephemeral pastes (PrivateBin v2 protocol)

#### Architecture
- Unified server — single MCP process, one config
- Graceful degradation — only enables tools for services with configured credentials
- Protocol mix: Infomaniak REST API where available, IMAP/SMTP for mail, CardDAV for contacts, PrivateBin for kPaste
- Error boundaries on all tool handlers via `safeHandler` wrapper

#### Quality pass (v0.1.0)
- Fixed kPaste encryption: proper PrivateBin v2 with PBKDF2 (100k iterations), zlib compression, correct adata
- Fixed Swiss Transfer: implemented 3-step upload flow (init → upload → finalize)
- Fixed CardDAV: stale client reconnection, proper etag handling, vCard line unfolding
- Fixed Calendar: regex-based date parsing instead of Date() to avoid timezone drift
- Fixed Contacts vCard: added required N field, proper TYPE parameters on EMAIL/TEL
- Fixed Mail: proper IMAP search() + fetch() two-step, added References header for threading
- Fixed API client: Content-Type only on POST/PUT/PATCH, not GET/DELETE
- Added kDrive file upload (multipart)
- Added contacts search tool
- Added file size guard on downloads (>50MB blocked)
- All tools return `messageId` for reply threading support

---

## Backlog / Known Issues

### Needs real-world testing
- [ ] kDrive share-link, version, trash, comment, recents, and activity endpoints
- [ ] kChat channel/post/thread/reaction/user/DM endpoints with `KCHAT_TOKEN` and `KCHAT_TEAM_NAME`
- [ ] kMeet room settings endpoint (`/1/kmeet/rooms/{room_id}/settings`)
- [ ] Swiss Transfer upload flow (API is undocumented, based on observed behavior)
- [ ] kMeet room creation endpoint (`/1/kmeet/rooms`)
- [ ] Chk URL shortener endpoint (`/1/url-shortener` — documented but untested)
- [ ] Calendar update/delete (endpoints inferred from Infomaniak's own MCP server patterns)
- [ ] kPaste PrivateBin v2 protocol (encryption format matches spec but untested against server)

### Missing features
- [ ] Mail API: attachment download and attachment sending without IMAP/SMTP fallback
- [ ] Mail: save draft
- [ ] Mail: create/delete/rename folders
- [ ] Mail: API-backed search, move/delete, and flag operations
- [ ] Mail: connection pooling for IMAP/SMTP fallback operations
- [ ] Contacts: multiple emails/phones per contact (create currently supports one each)
- [ ] Calendar: recurring events
- [ ] Calendar: RSVP / invitation handling
- [ ] Calendar: reminders / alarms
- [ ] Swiss Transfer: download a received transfer
- [ ] Swiss Transfer: list past transfers
- [ ] kPaste: read/decrypt a paste by URL
- [ ] Newsletter: campaign management (API exists at newsletter.infomaniak.com)
- [ ] kChat: file upload/download and webhook/command management

### API verification needed
- [ ] Confirm kMeet `/1/kmeet/rooms` endpoint accepts Bearer token end-to-end
- [ ] Confirm Chk `/1/url-shortener` response shape
- [ ] Confirm Calendar PUT for update returns updated event
- [ ] Confirm Calendar DELETE endpoint
- [ ] Test Swiss Transfer init/upload/complete flow end-to-end
- [ ] Verify kDrive upload endpoint and multipart format
