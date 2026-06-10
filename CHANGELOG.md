# Changelog

## Unreleased

No changes yet.

## [1.0.0] - 2026-06-10

### Added
- Release: promoted the package and MCP server metadata to `1.0.0`
- MCP: added `INFOMANIAK_SERVICES`, `INFOMANIAK_TOOLS`, and `INFOMANIAK_DISABLED_TOOLS` filters to reduce the advertised `tools/list` surface
- MCP: added `INFOMANIAK_READONLY=1` to advertise only tools explicitly marked as read-only
- MCP: added `INFOMANIAK_PROFILE` presets (`mail`, `files`, `calendar`, `assistant`, `safe-cleanup`) for smaller task-specific tool surfaces
- MCP: added `infomaniak_help`, an always-on read-only tool that explains the current filtered tool surface and safe workflows
- MCP: enriched `infomaniak_help` with per-tool argument names, risk labels, usage hints, next-tool suggestions, confirmation hints, and output-schema presence so agents can plan from the live advertised surface
- MCP: added an `infomaniak-temp://{id}` resource template so temp files returned by kDrive and mail download tools can be read through MCP `resources/read`
- MCP: added read-only workflow tools for mail triage, sender cleanup planning, meeting briefs, and recent kDrive context
- MCP: added workflow prompts for unread-mail summaries, meeting briefs, and guarded sender cleanup
- Infrastructure: added a shared throttled HTTP client with bounded concurrency, timeout handling, and retry/backoff for transient responses
- Mail: added `mail_spam_cleanup_preview` and `mail_spam_cleanup_confirm` for safe sender/domain blocking plus optional existing-message spam marking
- Mail: added API-backed sender search plus a safe bulk delete flow (`mail_bulk_delete_preview` + `mail_bulk_delete_confirm`) that recomputes the selection and moves messages to Trash only when the selection token and confirmation phrase match
- Mail: added API-backed spam controls for settings, spam auto-move, blocked senders, explicit spam marking, and read-only mailbox filter listing
- Mail: added `mail_query` for cursor-style summary searches with sender, unread, flagged, attachment, date, and text filters
- Mail: added `mail_save_draft` plus `mail_create_folder`, `mail_rename_folder`, and `mail_delete_folder`, with Mail API first and IMAP fallback where useful
- Calendar: added RRULE recurrence and reminder offset support to event create/update tools
- Contacts: added multiple email and phone value support for contact create/update
- kPaste: added confirmed `kpaste_read` for local URL-fragment decrypt of existing paste URLs
- kDrive/Chk: added cursor-style page tools (`kdrive_list_files_page`, `chk_list_short_urls_page`) while keeping legacy array-returning list tools unchanged
- Contacts: added `contacts_query`, a fast limited contact-summary read path backed by a short-lived summary cache
- Diagnostics: added opt-in `INFOMANIAK_TRACE=1` logs for redacted per-tool and HTTP request timings, with shared trace IDs across tool and HTTP logs
- Diagnostics: added opt-in `INFOMANIAK_AUDIT` / `INFOMANIAK_AUDIT_LOG` JSONL audit events for sanitized MCP tool calls
- Safety: added opt-in `STRICT_CONFIRM_EXTERNAL_SEND` / `INFOMANIAK_STRICT_CONFIRM_EXTERNAL_SEND` confirmation checks for `mail_send`, kChat message tools, and experimental `swisstransfer_send`
- Tooling: added `npm run bench:readonly` for read-only p50/p95 timing probes against the configured MCP server
- Tooling: added `npm run verify:mcp` and `npm run verify:release` release gates for protocol discovery, whitespace checks, package dry-run, and optional read-only smoke

### Changed
- Dependencies: pinned `@modelcontextprotocol/sdk` to `1.29.0`, the SDK version used by the structured tool output implementation
- MCP: tightened output schemas for high-volume non-mail read tools so clients can rely on stable identity fields
- MCP: marked mail, calendar, contact, and kChat user-controlled fields with `_meta["infomaniak/untrustedContent"]` hints for prompt-injection-aware clients
- MCP: mail tools now register with annotations and structured results so clients can distinguish read-only, mutating, and destructive operations
- MCP: high-volume kDrive, Calendar, Contacts, Tasks, and kChat read tools now expose read-only annotations and output schemas
- kDrive/Mail: download resource links now point at MCP-readable `infomaniak-temp://...` resources with size, last-modified, and expiry metadata while retaining private local file paths in structured content
- kDrive/Mail: expired temp resources are pruned during resource listing and reads, and the registry evicts old entries when it reaches its size limit
- kDrive: large downloads now save to a temp file and return a `resource_link`; small files can still be returned as inline base64
- Contacts/Tasks: CardDAV and CalDAV clients now connect lazily and cache collection discovery for a short TTL to reduce repeated DAV calls during agent workflows
- Mail: API-backed search and sender cleanup reduce IMAP fallback usage for common cleanup workflows
- Mail: `mail_read_message` now defaults to metadata-only reads from the MCP tool, with explicit body/header/thread opt-ins
- Mail: `mail_download_attachment` now saves attachments to a temp file and returns a resource link by default; inline base64 is opt-in for small files
- Mail: single-message move/delete/flag operations now use the Mail API first and fall back to IMAP when needed
- Mail: mailbox discovery and folder discovery now use TTL caches plus in-flight request coalescing
- Mail: `mail_query` cursors now anchor to the first page and skip already-returned messages so new arrivals do not disturb pagination
- Mail: move/delete/flag/spam/bulk-cleanup paths now invalidate affected mailbox caches so subsequent reads do not use stale folder discovery
- Mail: draft and folder mutation paths invalidate mailbox/folder caches so folder discovery stays fresh after organization workflows
- Mail: blocked sender entries now accept Infomaniak-compatible `@domain` shorthand and wildcard patterns such as `*@example.com`
- kChat: `KCHAT_TEAM_NAME` now accepts either a team slug or full kChat URL, and network failures include actionable configuration guidance
- kChat: API calls now use the shared throttled HTTP client for retry, timeout, and bounded concurrency behavior
- Docs: cleaned the README and roadmap to reflect the 100-tool stable surface and the new draft, folder, recurrence, reminder, contact, and kPaste read capabilities
- Docs: clarified that this MCP is user-scoped and linked the admin-focused `infomaniak-admin-mcp` companion for tenant/account administration workflows
- Docs: added Mermaid architecture diagrams and a 1.0 release checklist
- Smoke tests: read-only smoke now validates temp-resource template discovery
- Smoke/bench scripts: profile and filter environment variables are forwarded to child MCP processes, and read-only probes cover workflow/page tools when available

### Security
- Dependencies: upgraded the mail fallback stack and refreshed transitive packages so `npm audit --omit=dev` reports zero vulnerabilities
- Downloads: temp files for mail attachments and large kDrive downloads now use private `0700` directories and `0600` files
- Destructive tools: kDrive, Calendar, Contacts, Tasks, and Chk delete operations now require exact confirmation phrases
- kPaste: updated tool copy and responses to warn that returned fragment URLs are transcript-visible secrets
- Swiss Transfer: validates server-returned upload hosts and URL-encodes upload path segments before uploading chunks

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
- [ ] kChat channel/post/thread/reaction/user/DM endpoints with `KCHAT_TOKEN` and `KCHAT_TEAM_NAME`
- [ ] Swiss Transfer upload flow (API is undocumented, based on observed behavior)
- [ ] Mail API draft and folder-management endpoints with a live user mailbox
- [ ] Calendar recurrence and reminder fields with a live user calendar
- [ ] kPaste read/decrypt behavior against live server responses, especially burn-after-reading pastes
- [ ] kDrive upload endpoint and multipart format with a live file write
- [ ] kMeet room creation/settings endpoints with a live user account
- [ ] Chk create/delete response shapes with a live user account

### Missing features
- [ ] Mail API: attachment download and attachment sending without IMAP/SMTP fallback
- [ ] Mail: connection pooling for IMAP/SMTP fallback operations
- [ ] Calendar: RSVP / invitation handling
- [ ] Swiss Transfer: download a received transfer
- [ ] Swiss Transfer: list past transfers
- [ ] kChat: file upload/download and webhook/command management
- [ ] Newsletter: campaign management belongs in the separate tenant/admin MCP unless Infomaniak exposes user-scoped newsletter APIs

### API verification needed
- [ ] Confirm kMeet `/1/kmeet/rooms` endpoint accepts Bearer token end-to-end
- [ ] Confirm Chk `/1/url-shortener` response shape
- [ ] Confirm Calendar PUT/DELETE plus recurrence/reminder payloads return expected event shapes
- [ ] Confirm Mail API draft create and folder create/rename/delete endpoint shapes
- [ ] Test Swiss Transfer init/upload/complete flow end-to-end
- [ ] Verify kPaste read response shape and burn-after-reading lifecycle end-to-end
