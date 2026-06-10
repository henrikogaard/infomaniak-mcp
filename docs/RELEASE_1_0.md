# 1.0 Release Checklist

This checklist is for launching `@henrikogard/infomaniak-mcp` as the stable user-scoped Infomaniak kSuite MCP server.

## Release Scope

Version `1.0.0` is the user productivity MCP. It includes:

- kDrive file operations, share links, versions, trash restore, comments, recents, activity, page tools, and resource-link downloads.
- Calendar event CRUD with attendees, recurrence rules, and reminder offsets.
- CalDAV task CRUD.
- Mail API first query/read/search/send, draft saving, folder management, sender cleanup, spam cleanup, filters, and single-message move/delete/flag.
- IMAP/SMTP fallback for attachment download/sending, draft attachments, full-body search, and fallback message/folder operations.
- CardDAV contacts with fast query and multiple email/phone fields.
- kChat user conversation tools.
- kMeet room creation, scheduling, and settings.
- Chk short URL tools with page reads.
- kPaste create and confirmed local read/decrypt.
- Optional Euria AI tools.
- Experimental Swiss Transfer tools hidden by default.
- `infomaniak_help`, workflow prompts, structured output, annotations, resource links, trace logs, and sanitized audit logs.

Out of scope for this repo:

- Tenant or account administration.
- Organization-wide mail security and mailbox administration.
- Domains, DNS, hosting, and account governance.
- kDrive or kChat administrator governance.

Use [`infomaniak-admin-mcp`](https://github.com/henrikogaard/infomaniak-admin-mcp) for those workflows.

## Preflight

```bash
node --version
npm --version
npm ci
npm run build
npm test
git diff --check
```

Expected:

- Node.js is at least 18.
- TypeScript builds with no errors.
- The test suite passes.
- `git diff --check` reports no whitespace issues.

## Protocol Verification

```bash
npm run verify:mcp
VERIFY_MCP_CODEX_SERVER=infomaniak npm run verify:mcp
```

Expected:

- `tools/list` succeeds.
- `prompts/list` succeeds.
- `resources/templates/list` succeeds.
- `infomaniak_help` is advertised.
- `infomaniak_temp_file` resource template is advertised.
- Tool count depends on credentials and filters. With all stable services configured, expect 100 tools and 3 prompts. Swiss Transfer adds 2 tools only when explicitly enabled.

## Non-Destructive Smoke

```bash
npm run smoke:readonly
SMOKE_CODEX_SERVER=infomaniak npm run smoke:readonly
```

This is the safest live check. It:

- exercises MCP over stdio,
- validates read-only and destructive metadata,
- validates output schemas,
- checks workflow prompt discovery,
- checks temp-resource template discovery,
- calls read-only service probes,
- does not send mail,
- does not create files,
- does not delete or move mailbox data.

## Owned Write Smoke

```bash
npm run smoke:write-owned
```

This is still designed to be contained, but it mutates real services. It creates clearly named `MCP Smoke Owned ...` artifacts and deletes only artifacts it created during the same run.

Use this only when you are comfortable with a live write test.

## Full Live Smoke

```bash
npm run smoke:live
```

This is the broadest live check. It may create temporary artifacts, send one approved self-email when configured, and delete or move only cleanup targets. Prefer `smoke:readonly` for routine validation.

Swiss Transfer is skipped unless:

```bash
ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 \
SWISSTRANSFER_RECAPTCHA_TOKEN="<fresh browser token>" \
npm run smoke:live
```

## Benchmark

```bash
npm run bench:readonly
BENCH_CODEX_SERVER=infomaniak npm run bench:readonly
```

The benchmark is read-only. It reports `avgMs`, `p50Ms`, and `p95Ms` for common tool paths such as `tools/list`, `mail_query`, metadata-only `mail_read_message`, `kdrive_list_files_page`, `meeting_brief`, `contacts_query`, and `tasks_list`.

Use it to compare performance before and after changes. Do not treat a single run as a strict SLA.

## Release Gate

```bash
npm run verify:release
VERIFY_RELEASE_MCP=1 npm run verify:release
VERIFY_RELEASE_SMOKE=1 npm run verify:release
```

Default `verify:release` runs:

- `npm test`
- `git diff --check`
- `npm pack --dry-run`

The optional environment variables add protocol verification and read-only smoke.

## Package Check

```bash
npm pack --dry-run
```

The package should include:

- `dist`
- `README.md`
- `LICENSE`
- `docs`
- `scripts`

It should not include local `.env` files, test mail payloads, private temp files, or local smoke output.

## Security Check

```bash
npm audit --omit=dev
```

Expected: zero production vulnerabilities.

Before publishing, also manually check:

- no secrets in README examples,
- no real tokens in config snippets,
- no mailbox content in test fixtures or docs,
- no local temp-resource files in the package.

## Publish

```bash
npm login
npm publish --access public
```

After publishing:

```bash
npm view @henrikogard/infomaniak-mcp version
npm view @henrikogard/infomaniak-mcp bin
npm view @henrikogard/infomaniak-mcp repository.url
```

## Known 1.0 Caveats

- Swiss Transfer remains experimental and disabled by default.
- Some Infomaniak endpoints are inferred from observed or official-app behavior and need ongoing live verification.
- Mail API attachment download/sending still uses IMAP/SMTP fallback.
- IMAP/SMTP fallback opens a new connection per operation.
- `kpaste_read` can consume burn-after-reading pastes and therefore requires acknowledgement.
- Mobile MCP clients are out of scope because this is a local STDIO server.
