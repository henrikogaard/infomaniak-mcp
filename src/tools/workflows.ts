import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalendarService } from "../services/calendar.js";
import type { ContactsService } from "../services/contacts.js";
import type { KDriveService } from "../services/kdrive.js";
import type { MailMessageSummary, MailSenderMessage, MailToolService } from "../services/mail.js";
import { structuredResult } from "../tool-handler.js";
import { objectOutputSchema, readOnlyTool, registerStructuredTool } from "./register.js";

export interface WorkflowToolServices {
  mail?: Partial<MailToolService>;
  calendar?: CalendarService;
  contacts?: ContactsService;
  kdrive?: KDriveService;
}

export function registerWorkflowTools(server: McpServer, services: WorkflowToolServices): void {
  if (services.mail?.queryMessages) {
    registerStructuredTool(
      server,
      "mail_triage_summary",
      "Summarize recent mail metadata for triage without reading message bodies.",
      {
        folder: z.string().optional().describe("Folder path or folder_id:<id>. Defaults to INBOX."),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID"),
        unread: z.boolean().optional().describe("Only include unread messages"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum messages to inspect. Defaults to 25."),
      },
      readOnlyTool,
      async ({ folder, mailbox_uuid, unread, limit }) => {
        const result = await services.mail!.queryMessages!({
          folder: folder ?? "INBOX",
          mailboxUuid: mailbox_uuid,
          unread,
          limit: limit ?? 25,
        });
        const messages = result.messages;
        return structuredResult({
          mailboxUuid: result.mailboxUuid,
          folderPath: result.folderPath,
          total: result.total,
          scannedCount: result.scannedCount,
          returned: messages.length,
          unreadOnly: unread === true,
          flaggedCount: messages.filter((message) => isFlagged(message)).length,
          attachmentCount: messages.filter((message) => message.hasAttachments).length,
          countsBySender: countBy(messages.map((message) => normalizeSender(message.from))),
          newestDate: firstDate(messages),
          oldestDate: lastDate(messages),
          messages,
        });
      },
      objectOutputSchema
    );
  }

  if (services.mail?.findMessagesBySender) {
    registerStructuredTool(
      server,
      "sender_cleanup_plan",
      "Build a read-only sender cleanup plan before calling mail_bulk_delete_preview.",
      {
        sender: z.string().describe("Full sender email address or @domain"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID"),
        folders: z.array(z.string()).optional().describe("Optional folder names/paths/roles or folder_id:<id> values to scan"),
        all_folders: z.boolean().optional().describe("Scan all folders returned by mail_list_folders"),
        max_results: z.number().int().min(1).max(1000).optional().describe("Maximum matching messages to include. Defaults to 100."),
      },
      readOnlyTool,
      async ({ sender, mailbox_uuid, folders, all_folders, max_results }) => {
        const result = await services.mail!.findMessagesBySender!({
          sender,
          mailboxUuid: mailbox_uuid,
          folders,
          allFolders: all_folders,
          maxResults: max_results ?? 100,
        });
        return structuredResult({
          mailboxUuid: result.mailboxUuid,
          mailboxEmail: result.mailboxEmail,
          sender: result.sender,
          count: result.count,
          truncated: result.truncated,
          folders: result.scannedFolders,
          newestDate: firstSenderDate(result.messages),
          oldestDate: lastSenderDate(result.messages),
          nextPreviewTool: "mail_bulk_delete_preview",
          recommendedConfirmationTool: "mail_bulk_delete_confirm",
          safety: "This is read-only. Review folders/counts, then call mail_bulk_delete_preview before any destructive confirmation.",
          messages: result.messages,
        });
      },
      objectOutputSchema
    );
  }

  if (services.calendar) {
    registerStructuredTool(
      server,
      "meeting_brief",
      "Collect upcoming events and related contact summaries for meeting preparation.",
      {
        days: z.number().int().min(1).max(31).optional().describe("Days ahead to inspect. Defaults to 7."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum events to return. Defaults to 10."),
      },
      readOnlyTool,
      async ({ days, limit }) => {
        const from = new Date();
        const to = new Date(from.getTime() + (days ?? 7) * 24 * 60 * 60 * 1000);
        const events = (await services.calendar!.listEvents(from.toISOString(), to.toISOString()))
          .slice(0, limit ?? 10);
        const attendeeEmails = unique(events.flatMap((event) => extractAttendeeEmails(event as Record<string, unknown>)));
        const relatedContacts = services.contacts?.queryContacts
          ? (await Promise.all(attendeeEmails.map((email) => services.contacts!.queryContacts({ query: email, limit: 1 })))).flat()
          : [];
        return structuredResult({
          from: from.toISOString(),
          to: to.toISOString(),
          eventCount: events.length,
          attendeeEmails,
          relatedContacts,
          events,
        });
      },
      objectOutputSchema
    );
  }

  if (services.kdrive?.listRecents) {
    registerStructuredTool(
      server,
      "kdrive_recent_context",
      "Collect recent kDrive items as a compact context packet.",
      {
        limit: z.number().int().min(1).max(100).optional().describe("Maximum recent items to return. Defaults to 10."),
        type: z.string().optional().describe("Optional item type filter such as file or dir"),
      },
      readOnlyTool,
      async ({ limit, type }) => {
        const result = await services.kdrive!.listRecents({ limit: limit ?? 10, type }) as unknown;
        const items = Array.isArray(result)
          ? result
          : Array.isArray((result as { items?: unknown[] })?.items)
            ? (result as { items: unknown[] }).items
            : Array.isArray((result as { data?: unknown[] })?.data)
              ? (result as { data: unknown[] }).data
              : [];
        return structuredResult({
          count: items.length,
          type: type ?? null,
          items,
        });
      },
      objectOutputSchema
    );
  }
}

function normalizeSender(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match?.[1] ?? from).trim().toLowerCase();
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function isFlagged(message: MailMessageSummary): boolean {
  return message.flagged === true || message.flags.some((flag) => flag.toLowerCase().includes("flagged"));
}

function firstDate(messages: MailMessageSummary[]): string | undefined {
  return messages[0]?.date;
}

function lastDate(messages: MailMessageSummary[]): string | undefined {
  return messages[messages.length - 1]?.date;
}

function firstSenderDate(messages: MailSenderMessage[]): string | undefined {
  return messages[0]?.date;
}

function lastSenderDate(messages: MailSenderMessage[]): string | undefined {
  return messages[messages.length - 1]?.date;
}

function extractAttendeeEmails(event: Record<string, unknown>): string[] {
  const attendees = event.attendees;
  if (!Array.isArray(attendees)) return [];
  return attendees
    .map((attendee) => typeof attendee === "object" && attendee !== null ? (attendee as { address?: unknown }).address : undefined)
    .filter((value): value is string => typeof value === "string" && value.includes("@"));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}
