import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredToolSummary } from "../tool-filter.js";
import { structuredResult } from "../tool-handler.js";
import { objectOutputSchema, readOnlyTool, registerStructuredTool } from "./register.js";

const SERVICE_ORDER = [
  "mail",
  "kdrive",
  "calendar",
  "contacts",
  "tasks",
  "kchat",
  "kmeet",
  "chk",
  "kpaste",
  "ai",
  "swisstransfer",
  "workflows",
  "mcp",
] as const;

const HELP_SERVICE_VALUES = ["all", ...SERVICE_ORDER] as const;

export function registerHelpTool(
  server: McpServer,
  getTools: () => RegisteredToolSummary[]
): void {
  registerStructuredTool(
    server,
    "infomaniak_help",
    "List the currently available Infomaniak MCP tools with service groups, argument names, safety/risk labels, usage hints, and safe workflow suggestions. Use this first when the user asks what this MCP can do, which tools exist, or how it can help.",
    {
      service: z.enum(HELP_SERVICE_VALUES).optional().describe("Optional service/category to focus on. Defaults to all."),
      include_tools: z.boolean().optional().describe("Include individual tool names and descriptions. Defaults to true."),
    },
    readOnlyTool,
    async ({ service, include_tools }) => {
      const tools = getTools();
      const includeTools = include_tools !== false;
      const groups = groupTools(tools)
        .filter((group) => !service || service === "all" || group.service === service);
      const workflows = suggestedWorkflows(new Set(tools.map((tool) => tool.name)))
        .filter((workflow) => !service || service === "all" || workflow.services.includes(service));

      return structuredResult({
        server: "infomaniak-ksuite",
        totalTools: tools.length + 1,
        note: "This help reflects the tools currently advertised by this MCP process after credentials, profiles, read-only mode, and filters were applied.",
        discovery: {
          liveToolList: "MCP clients call tools/list to get exact names, descriptions, schemas, and safety annotations.",
          thisHelpTool: "Call infomaniak_help with service set to mail, kdrive, calendar, contacts, tasks, kchat, kmeet, chk, kpaste, ai, swisstransfer, workflows, or all.",
          argumentNames: "The arguments array lists top-level parameter names for quick planning. Use tools/list for full JSON schemas, required fields, enum values, and field descriptions.",
          prompts: "Workflow prompts are available through prompts/list.",
          resources: "Large downloads may return infomaniak-temp:// resource links readable through resources/read.",
        },
        groups: groups.map((group) => ({
          ...group,
          tools: includeTools ? group.tools : undefined,
        })),
        suggestedWorkflows: workflows,
      });
    },
    objectOutputSchema
  );
}

function groupTools(tools: RegisteredToolSummary[]) {
  const grouped = new Map<string, RegisteredToolSummary[]>();
  for (const tool of tools) {
    const service = serviceForTool(tool.name);
    grouped.set(service, [...(grouped.get(service) ?? []), tool]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => serviceRank(left) - serviceRank(right) || left.localeCompare(right))
    .map(([service, serviceTools]) => ({
      service,
      summary: serviceSummary(service),
      count: serviceTools.length,
      readOnlyCount: serviceTools.filter((tool) => tool.readOnly).length,
      destructiveCount: serviceTools.filter((tool) => tool.destructive).length,
      tools: serviceTools
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          readOnly: tool.readOnly,
          destructive: tool.destructive,
          risk: toolRisk(tool),
          arguments: tool.inputKeys ?? [],
          hasOutputSchema: tool.hasOutputSchema === true,
          useWhen: useWhenForTool(tool),
          nextTools: nextToolsForTool(tool.name, new Set(serviceTools.map((candidate) => candidate.name))),
          confirmation: confirmationHintForTool(tool.name),
        })),
    }));
}

function serviceForTool(name: string): string {
  if (["mail_triage_summary", "sender_cleanup_plan", "meeting_brief", "kdrive_recent_context"].includes(name)) {
    return "workflows";
  }
  const prefix = name.split("_", 1)[0];
  return isKnownService(prefix) ? prefix : "mcp";
}

function serviceRank(service: string): number {
  const index = SERVICE_ORDER.findIndex((candidate) => candidate === service);
  return index === -1 ? SERVICE_ORDER.length : index;
}

function isKnownService(value: string): value is typeof SERVICE_ORDER[number] {
  return SERVICE_ORDER.some((service) => service === value);
}

function serviceSummary(service: string): string {
  switch (service) {
    case "mail":
      return "Mailbox discovery, fast metadata queries, message reads, sending, draft saving, folder management, sender cleanup, spam blocking, filters, and attachment downloads.";
    case "kdrive":
      return "kDrive search, listing, paginated reads, downloads via resource links, uploads, sharing, versions, trash, comments, recents, and activity.";
    case "calendar":
      return "Calendar discovery and event CRUD with recurrence and reminder fields.";
    case "contacts":
      return "CardDAV address book discovery, fast contact queries, contact reads, and contact CRUD with multiple emails/phones.";
    case "tasks":
      return "CalDAV task calendar discovery, task search/list/read, and VTODO task CRUD.";
    case "kchat":
      return "kChat channel reads, thread reads, users, posts, replies, reactions, and direct messages.";
    case "kmeet":
      return "kMeet room creation, scheduling, and room settings.";
    case "chk":
      return "Chk short URL creation, listing, paginated reads, and deletion.";
    case "kpaste":
      return "Zero-knowledge encrypted paste creation plus confirmed local read/decrypt for paste URLs.";
    case "ai":
      return "Infomaniak Euria model listing, chat, embeddings, and transcription.";
    case "swisstransfer":
      return "Experimental Swiss Transfer send/info tools when explicitly enabled.";
    case "workflows":
      return "Read-only aggregate workflows that combine service calls into compact context packets.";
    default:
      return "MCP server metadata and capability help.";
  }
}

function suggestedWorkflows(toolNames: Set<string>) {
  const workflows = [];
  if (toolNames.has("mail_triage_summary") && toolNames.has("mail_read_message")) {
    workflows.push({
      name: "Summarize unread mail",
      services: ["mail", "workflows"],
      steps: ["mail_triage_summary", "mail_read_message only for selected messages"],
      safety: "Starts metadata-only and reads bodies only when needed.",
    });
  }
  if (toolNames.has("sender_cleanup_plan") && toolNames.has("mail_bulk_delete_preview")) {
    workflows.push({
      name: "Clean up a sender",
      services: ["mail", "workflows"],
      steps: ["sender_cleanup_plan", "mail_bulk_delete_preview", "mail_bulk_delete_confirm after exact user confirmation"],
      safety: "Preview-before-confirm; messages are moved to Trash, not permanently purged.",
    });
  }
  if (toolNames.has("mail_spam_cleanup_preview")) {
    workflows.push({
      name: "Block a spammer",
      services: ["mail"],
      steps: ["mail_spam_cleanup_preview", "review blockPattern and matching messages", "mail_spam_cleanup_confirm after exact user confirmation"],
      safety: "User-mailbox scoped; can block future sender/domain mail and optionally mark existing matches as spam.",
    });
  }
  if (toolNames.has("mail_save_draft")) {
    workflows.push({
      name: "Prepare a mail draft",
      services: ["mail"],
      steps: ["mail_read_message when replying to existing mail", "mail_save_draft", "user reviews and sends from their mail client or calls mail_send explicitly"],
      safety: "Writes a draft only; it does not send mail.",
    });
  }
  if (toolNames.has("mail_create_folder") && toolNames.has("mail_list_folders")) {
    workflows.push({
      name: "Organize mail folders",
      services: ["mail"],
      steps: ["mail_list_folders", "mail_create_folder or mail_rename_folder", "mail_delete_folder only after exact confirmation"],
      safety: "Folder deletion is destructive and requires an exact confirmation phrase.",
    });
  }
  if (toolNames.has("meeting_brief")) {
    workflows.push({
      name: "Prepare a meeting brief",
      services: ["calendar", "contacts", "workflows"],
      steps: ["meeting_brief", "calendar_list_events or contacts_query for extra detail"],
      safety: "Read-only aggregation.",
    });
  }
  if (toolNames.has("kdrive_recent_context") || toolNames.has("kdrive_list_files_page")) {
    workflows.push({
      name: "Find recent file context",
      services: ["kdrive", "workflows"],
      steps: ["kdrive_recent_context", "kdrive_search or kdrive_list_files_page", "kdrive_download_file if needed"],
      safety: "Large downloads return resource links instead of inline payloads.",
    });
  }
  if (toolNames.has("kpaste_create") || toolNames.has("kpaste_read")) {
    workflows.push({
      name: "Handle an encrypted paste",
      services: ["kpaste"],
      steps: ["kpaste_create for a new secret", "kpaste_read only when the user acknowledges burn-after-reading risk"],
      safety: "Paste content and URL fragments are secrets; reading a burn-after-reading paste may consume it.",
    });
  }
  return workflows;
}

function toolRisk(tool: Pick<RegisteredToolSummary, "readOnly" | "destructive">): "read" | "write" | "destructive" {
  if (tool.destructive) return "destructive";
  if (tool.readOnly) return "read";
  return "write";
}

function useWhenForTool(tool: Pick<RegisteredToolSummary, "name" | "readOnly" | "destructive">): string {
  const specific = TOOL_USE_HINTS[tool.name];
  if (specific) return specific;
  if (tool.destructive) {
    return "Use only after the user explicitly asks for the action and provides the exact confirmation phrase.";
  }
  if (tool.readOnly) {
    return "Use to inspect current state before choosing a more specific read or write tool.";
  }
  if (tool.name.includes("_create") || tool.name.includes("_upload") || tool.name.includes("_send")) {
    return "Use when the user explicitly asks to create, upload, or send new content.";
  }
  if (tool.name.includes("_update") || tool.name.includes("_rename") || tool.name.includes("_move") || tool.name.includes("_flag")) {
    return "Use when the user explicitly asks to change existing content after identifying the target.";
  }
  return "Use when the user asks for this service action and you have the required identifiers.";
}

function nextToolsForTool(name: string, availableTools: Set<string>): string[] {
  const candidates = NEXT_TOOL_HINTS[name] ?? [];
  return candidates.filter((candidate) => availableTools.has(candidate));
}

function confirmationHintForTool(name: string): string | undefined {
  if (name === "kpaste_read") return "Requires: ACKNOWLEDGE KPASTE READ RISK";
  if (name === "mail_delete_folder") return "Requires: DELETE MAIL FOLDER <folder>";
  if (name === "mail_bulk_delete_confirm") return "Requires the preview token and preview confirmation phrase from mail_bulk_delete_preview.";
  if (name === "mail_spam_cleanup_confirm") return "Requires the preview token and preview confirmation phrase from mail_spam_cleanup_preview.";
  if (name === "mail_mark_spam") return "Requires an exact confirmation phrase from the tool description.";
  if (name === "kdrive_delete") return "Requires: DELETE <file_id>";
  if (name === "kdrive_delete_share_link") return "Requires: DELETE SHARE LINK <file_id>";
  if (name === "kdrive_delete_comment") return "Requires: DELETE COMMENT <comment_id>";
  if (name === "calendar_delete_event") return "Requires exact confirmation.";
  if (name === "contacts_delete") return "Requires exact confirmation.";
  if (name === "tasks_delete") return "Requires exact confirmation.";
  if (name === "chk_delete_short_url") return "Requires exact confirmation.";
  return undefined;
}

const TOOL_USE_HINTS: Record<string, string> = {
  infomaniak_help: "Use first when the user asks what tools are available, what the MCP can do, or which workflow is safest.",
  mail_list_mailboxes: "Use first for Mail API workflows to choose the mailbox_uuid when multiple mailboxes exist.",
  mail_list_folders: "Use before folder-specific mail reads, moves, draft placement, or folder cleanup.",
  mail_query: "Best default mail search/list tool: returns compact message summaries with filters and cursor pagination.",
  mail_triage_summary: "Use for quick unread/recent triage without reading message bodies.",
  mail_read_message: "Use after mail_query or mail_list_messages when a specific body, headers, or thread context is needed.",
  mail_find_by_sender: "Use when the user asks for mail from one exact sender or a whole @domain.",
  sender_cleanup_plan: "Use before sender cleanup to build a read-only plan and avoid accidental broad deletes.",
  mail_bulk_delete_preview: "Use before bulk sender cleanup; it previews matches and returns the token/phrase for confirmation.",
  mail_bulk_delete_confirm: "Use only after mail_bulk_delete_preview and explicit user confirmation; moves matches to Trash.",
  mail_spam_cleanup_preview: "Use to plan sender/domain blocking and optional existing-message spam marking.",
  mail_spam_cleanup_confirm: "Use only after reviewing mail_spam_cleanup_preview and explicit user confirmation.",
  mail_save_draft: "Use when composing or replying but the user wants a saved draft instead of sending now.",
  mail_send: "Use only when the user clearly wants to send email; prefer mail_save_draft for review workflows.",
  mail_create_folder: "Use after mail_list_folders when the user wants a new mailbox folder.",
  mail_rename_folder: "Use after mail_list_folders when the user wants to rename an existing folder.",
  mail_delete_folder: "Use only when the user explicitly wants to delete a folder and provides the exact confirmation.",
  kdrive_list_files_page: "Best default kDrive folder listing tool for agents; returns one bounded page with cursor data.",
  kdrive_recent_context: "Use for quick file context before searching broadly or downloading files.",
  kdrive_search: "Use when the user knows a file/folder name or content term.",
  kdrive_download_file: "Use after kdrive_get_file/search/list when file contents are needed; large files return resource links.",
  calendar_list_events: "Use to inspect a date range before creating, updating, deleting, or briefing meetings.",
  meeting_brief: "Use for a compact read-only briefing over upcoming events, contacts, and recent mail context.",
  calendar_create_event: "Use when the user asks to create a calendar event; supports attendees, RRULE, and reminders.",
  calendar_update_event: "Use after identifying the event_id; can update or clear recurrence/reminders.",
  contacts_query: "Best default contact lookup tool; fast limited summaries for names, emails, phones, and orgs.",
  contacts_get: "Use after contacts_query/search/list when full vCard details are needed.",
  contacts_create: "Use when the user wants a new contact; supports multiple emails and phones.",
  contacts_update: "Use after contacts_get when changing contact fields or replacing email/phone lists.",
  tasks_list: "Use to inspect open or completed tasks before task updates.",
  tasks_get: "Use after tasks_list/search when full VTODO details are needed.",
  kchat_list_channels: "Use first in kChat workflows to identify the channel ID/name.",
  kchat_get_channel_history: "Use before replying, reacting, or summarizing a channel.",
  kchat_get_thread_replies: "Use after a post ID is known to read thread context.",
  chk_list_short_urls_page: "Best default Chk listing tool for agents; returns a bounded page.",
  kpaste_create: "Use to create a zero-knowledge encrypted paste; treat the returned fragment URL as a secret.",
  kpaste_read: "Use only with explicit acknowledgement because reading burn-after-reading pastes may consume them.",
  ai_chat: "Use for Infomaniak Euria model calls when the user wants Swiss-hosted text generation.",
  ai_embeddings: "Use to create embeddings for semantic search or clustering workflows.",
  swisstransfer_send: "Experimental; use only when enabled and the user provides a fresh browser-generated reCAPTCHA token.",
};

const NEXT_TOOL_HINTS: Record<string, string[]> = {
  mail_list_mailboxes: ["mail_list_folders", "mail_query"],
  mail_list_folders: ["mail_query", "mail_list_messages", "mail_create_folder"],
  mail_list_messages: ["mail_read_message", "mail_move", "mail_flag", "mail_delete"],
  mail_query: ["mail_read_message", "mail_save_draft", "mail_move", "mail_flag", "mail_bulk_delete_preview"],
  mail_triage_summary: ["mail_query", "mail_read_message"],
  mail_read_message: ["mail_save_draft", "mail_send", "mail_move", "mail_flag"],
  mail_find_by_sender: ["sender_cleanup_plan", "mail_bulk_delete_preview", "mail_spam_cleanup_preview"],
  sender_cleanup_plan: ["mail_bulk_delete_preview"],
  mail_bulk_delete_preview: ["mail_bulk_delete_confirm"],
  mail_spam_cleanup_preview: ["mail_spam_cleanup_confirm"],
  kdrive_search: ["kdrive_get_file", "kdrive_download_file", "kdrive_list_files_page"],
  kdrive_list_files: ["kdrive_get_file", "kdrive_download_file", "kdrive_create_folder"],
  kdrive_list_files_page: ["kdrive_get_file", "kdrive_download_file", "kdrive_create_folder"],
  kdrive_recent_context: ["kdrive_search", "kdrive_get_file", "kdrive_download_file"],
  kdrive_get_file: ["kdrive_download_file", "kdrive_get_share_link", "kdrive_list_versions"],
  calendar_list_calendars: ["calendar_list_events", "calendar_create_event"],
  calendar_list_events: ["meeting_brief", "calendar_update_event", "calendar_delete_event"],
  contacts_query: ["contacts_get", "contacts_update", "contacts_create"],
  contacts_search: ["contacts_get", "contacts_update"],
  contacts_get: ["contacts_update", "contacts_delete"],
  tasks_list: ["tasks_get", "tasks_update", "tasks_complete"],
  tasks_search: ["tasks_get", "tasks_update", "tasks_complete"],
  tasks_get: ["tasks_update", "tasks_complete", "tasks_delete"],
  kchat_list_channels: ["kchat_get_channel_history", "kchat_post_message"],
  kchat_get_channel_history: ["kchat_get_thread_replies", "kchat_reply_to_thread", "kchat_add_reaction"],
  kchat_get_thread_replies: ["kchat_reply_to_thread", "kchat_add_reaction"],
  chk_list_short_urls: ["chk_delete_short_url"],
  chk_list_short_urls_page: ["chk_delete_short_url"],
  kpaste_create: ["kpaste_read"],
};
