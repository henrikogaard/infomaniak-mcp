# Architecture

This document describes the 1.0 runtime architecture for `@henrikogard/infomaniak-mcp`.

The server is a local STDIO MCP server. It is intentionally user-scoped: it helps one Infomaniak user work with their own kSuite data. Tenant administration, organization-wide mail security, domains, hosting, and governance workflows belong in the admin-focused companion project, [`infomaniak-admin-mcp`](https://github.com/henrikogaard/infomaniak-admin-mcp).

## Runtime Topology

```mermaid
flowchart TB
  user["User"]
  client["MCP client<br/>Claude Code, Claude Desktop, Codex, Cursor"]
  server["infomaniak-mcp<br/>Node.js, TypeScript, STDIO"]
  config["Config loader<br/>environment variables and optional .env"]
  filter["Tool filter<br/>profiles, allowlists, read-only mode"]
  registry["Tool registry<br/>descriptions, schemas, annotations"]
  temp["Temp resources<br/>private files and infomaniak-temp:// URIs"]

  user --> client
  client <-->|MCP initialize, tools/list, tools/call| server
  config --> server
  filter --> registry
  server --> registry
  server --> temp

  server --> api["api.infomaniak.com<br/>kDrive, Calendar, Chk, kMeet, Euria"]
  server --> mailapi["mail.infomaniak.com/api<br/>Mail API"]
  server --> imap["mail.infomaniak.com<br/>IMAP and SMTP fallback"]
  server --> dav["sync.infomaniak.com<br/>CardDAV and CalDAV"]
  server --> kchat["team.kchat.infomaniak.com<br/>kChat REST API"]
  server --> kpaste["kpaste.infomaniak.com<br/>PrivateBin protocol"]
  server -.->|experimental opt-in| transfer["www.swisstransfer.com<br/>Swiss Transfer"]
```

## Startup And Discovery

The server advertises only tools that can work with the configured credentials and feature flags.

```mermaid
sequenceDiagram
  participant Client as "MCP client"
  participant Server as "src/index.ts"
  participant Config as "loadConfig"
  participant Registry as "Tool registry"
  participant Tools as "Tool modules"

  Client->>Server: start process
  Server->>Config: read env and .env
  Config-->>Server: tokens, credentials, filters, flags
  Server->>Registry: create filtered tool server
  Server->>Tools: register services that have credentials
  Tools-->>Registry: tool name, description, schemas, annotations
  Server-->>Client: initialized over stdio
  Client->>Server: tools/list
  Server-->>Client: filtered live tool contracts
  Client->>Server: prompts/list and resources/templates/list
  Server-->>Client: workflow prompts and temp resource template
```

The important design rule: README examples are not the source of truth for the model. The live MCP `tools/list` response is. The `infomaniak_help` tool summarizes that live response into service groups, top-level arguments, risk labels, usage hints, next-tool suggestions, and confirmation hints.

## Internal Modules

```mermaid
flowchart LR
  index["src/index.ts<br/>composition root"]
  config["src/config.ts<br/>env config"]
  filter["src/tool-filter.ts<br/>profiles and visibility"]
  handler["src/tool-handler.ts<br/>safeHandler and result helpers"]
  register["src/tools/register.ts<br/>structured tool helpers"]
  services["src/services/*<br/>business logic and APIs"]
  tools["src/tools/*<br/>MCP tool contracts"]
  prompts["src/prompts/*<br/>workflow prompts"]
  trace["src/trace.ts<br/>timing diagnostics"]
  audit["src/audit-log.ts<br/>sanitized audit events"]
  temp["src/temp-resources.ts<br/>resource links"]

  index --> config
  index --> filter
  index --> tools
  index --> prompts
  index --> temp
  tools --> register
  tools --> handler
  tools --> services
  handler --> trace
  handler --> audit
  services --> trace
  services --> temp
```

## Tool Call Lifecycle

```mermaid
sequenceDiagram
  participant Client as "MCP client"
  participant Tool as "registered tool"
  participant Handler as "safeHandler"
  participant Service as "service class"
  participant Remote as "Infomaniak endpoint"

  Client->>Tool: tools/call
  Tool->>Handler: validated arguments
  Handler->>Handler: start trace and audit context
  Handler->>Service: typed service method
  Service->>Remote: authenticated request
  Remote-->>Service: data or error
  Service-->>Handler: domain result
  Handler-->>Tool: structuredContent, text, _meta
  Tool-->>Client: MCP tool result
```

Error handling is centralized through `safeHandler`. Tool handlers return `isError` MCP results instead of crashing the server process.

## Mail Routing

Mail uses a hybrid router. The Mail API is preferred for fast metadata, query, attachment, draft, folder, spam, filter, and single-message mutation paths. IMAP/SMTP remains the compatibility fallback for full-body search and unsupported or failed API operations.

```mermaid
flowchart TB
  tool["Mail tool"]
  hybrid["HybridMailService"]
  api{"Mail API supports this operation?"}
  legacy{"IMAP/SMTP fallback configured?"}
  mailapi["MailApiService<br/>mail.infomaniak.com/api"]
  imap["MailService<br/>IMAP/SMTP"]
  fail["Actionable error"]

  tool --> hybrid
  hybrid --> api
  api -- "Yes" --> mailapi
  api -- "No" --> legacy
  legacy -- "Yes" --> imap
  legacy -- "No" --> fail
```

Mailbox and folder discovery are cached with TTLs and in-flight request coalescing. Mutations that can change folder contents or folder discovery invalidate affected caches.

## Large Output And Resource Links

Large binary payloads should not be placed directly in MCP JSON responses. kDrive downloads and mail attachments can be saved to private temp files and returned as MCP resource links.

```mermaid
flowchart LR
  tool["Download tool"]
  size{"Small enough for inline output?"}
  inline["Return base64 in structuredContent"]
  file["Write private temp file<br/>0600 file in 0700 directory"]
  registry["Temp resource registry"]
  link["Return infomaniak-temp:// URI"]
  client["Client calls resources/read"]

  tool --> size
  size -- "Yes, and requested" --> inline
  size -- "No or default" --> file
  file --> registry
  registry --> link
  link --> client
```

Temp resources are local and private. They are pruned by expiry and by registry size.

## Safety Model

```mermaid
flowchart TB
  request["User request"]
  classify{"Tool risk"}
  read["Read-only<br/>query, list, get, brief"]
  write["Mutating<br/>create, update, send, move"]
  destructive["Destructive<br/>delete, bulk cleanup, burn-risk read"]
  confirm["Exact confirmation or preview token"]
  execute["Execute tool"]
  audit["Optional sanitized audit log"]

  request --> classify
  classify -- "readOnlyHint" --> read
  classify -- "write" --> write
  classify -- "destructiveHint" --> destructive
  read --> execute
  write --> execute
  destructive --> confirm
  confirm --> execute
  execute --> audit
```

Safety controls include:

- MCP annotations for read-only, mutating, and destructive tools.
- Exact confirmation phrases for destructive operations.
- Preview-before-confirm flows for sender cleanup and spam cleanup.
- Optional `STRICT_CONFIRM_EXTERNAL_SEND=1` for external send tools.
- Optional `INFOMANIAK_READONLY=1` to hide mutating tools from `tools/list`.
- Optional audit logging with redaction of secrets, bodies, confirmations, tokens, URL fragments, and email local parts.
- `_meta["infomaniak/untrustedContent"]` hints for mail, calendar, contact, and kChat user-controlled fields.

## Tool Surface Controls

```mermaid
flowchart LR
  env["Environment"]
  profile["INFOMANIAK_PROFILE"]
  services["INFOMANIAK_SERVICES"]
  allow["INFOMANIAK_TOOLS"]
  deny["INFOMANIAK_DISABLED_TOOLS"]
  readonly["INFOMANIAK_READONLY"]
  list["Final tools/list"]

  env --> profile
  env --> services
  env --> allow
  env --> deny
  env --> readonly
  profile --> list
  services --> list
  allow --> list
  deny --> list
  readonly --> list
```

Filtering changes only what the MCP client sees. It is not a substitute for least-privilege Infomaniak tokens or separate DAV/mail credentials.

## Launch Defaults

For 1.0:

- Stable user-facing tools are enabled by credentials.
- Swiss Transfer remains opt-in experimental.
- `infomaniak_help`, prompts, structured output, and annotations are part of the default experience.
- The package ships `dist`, `README.md`, `LICENSE`, `docs`, and `scripts`.
- Release verification is handled by `npm run verify:release`.
