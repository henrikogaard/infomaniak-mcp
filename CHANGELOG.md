# Changelog

## [0.1.0] - 2026-04-06

### Initial release — 42 tools across 9 Infomaniak services

#### Services added
- **kDrive** (9 tools) — search, list, get, download, upload, create folder, delete, move, rename
- **Calendar** (5 tools) — list calendars, list/create/update/delete events
- **Mail** (8 tools) — list folders, list/read/search/send/move/delete messages, flag management
- **Contacts** (7 tools) — list address books, list/search/get/create/update/delete contacts
- **AI Tools / Euria** (4 tools) — list models, chat completion, embeddings, audio transcription (Whisper)
- **Swiss Transfer** (2 tools) — send files (multi-step upload), get transfer info
- **kMeet** (3 tools) — create/list/delete video conference rooms
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
- [ ] Swiss Transfer upload flow (API is undocumented, based on observed behavior)
- [ ] kMeet room creation endpoint (`/1/meet/room` — inferred, not confirmed)
- [ ] Chk URL shortener endpoint (`/1/url-shortener` — documented but untested)
- [ ] Calendar update/delete (endpoints inferred from Infomaniak's own MCP server patterns)
- [ ] kPaste PrivateBin v2 protocol (encryption format matches spec but untested against server)

### Missing features
- [ ] kDrive: file sharing (generate share links with permissions)
- [ ] kDrive: file versions / history
- [ ] Mail: attachment download (only lists attachments, doesn't download content)
- [ ] Mail: save draft
- [ ] Mail: create/delete/rename folders
- [ ] Mail: connection pooling (currently opens new IMAP connection per operation)
- [ ] Contacts: multiple emails/phones per contact (create currently supports one each)
- [ ] Calendar: recurring events
- [ ] Calendar: RSVP / invitation handling
- [ ] Calendar: reminders / alarms
- [ ] Swiss Transfer: download a received transfer
- [ ] Swiss Transfer: list past transfers
- [ ] kPaste: read/decrypt a paste by URL
- [ ] kMeet: room settings (password, waiting room, recording)
- [ ] kMeet: scheduled meetings (integrate with calendar)
- [ ] Newsletter: campaign management (API exists at newsletter.infomaniak.com)
- [ ] kChat: messaging integration (official MCP server exists separately)

### API verification needed
- [ ] Confirm kMeet `/1/meet/room` endpoint exists and accepts Bearer token
- [ ] Confirm Chk `/1/url-shortener` response shape
- [ ] Confirm Calendar PUT for update returns updated event
- [ ] Confirm Calendar DELETE endpoint
- [ ] Test Swiss Transfer init/upload/complete flow end-to-end
- [ ] Verify kDrive upload endpoint and multipart format
