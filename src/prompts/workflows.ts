import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerWorkflowPrompts(server: McpServer): void {
  server.registerPrompt(
    "summarize_unread_mail",
    {
      title: "Summarize Unread Mail",
      description: "Summarize recent unread messages using fast metadata-first mail queries.",
      argsSchema: {
        folder: z.string().optional().describe("Folder to summarize, usually INBOX"),
        limit: z.string().optional().describe("Maximum unread messages to inspect"),
      },
    },
    ({ folder, limit }) => textPrompt(
      [
        `Summarize unread mail in ${folder ?? "INBOX"}.`,
        `Use mail_query first with status=unread, folder=${folder ?? "INBOX"}, and limit=${limit ?? "25"} so the workflow starts from metadata.`,
        "Only call mail_read_message with include_body=true for the few messages that genuinely need body context.",
        "Group the summary by priority, deadlines, and sender. Include message UIDs for follow-up actions.",
      ].join("\n")
    )
  );

  server.registerPrompt(
    "prepare_meeting_brief",
    {
      title: "Prepare Meeting Brief",
      description: "Build a meeting brief from upcoming calendar events, relevant contacts, and recent mail metadata.",
      argsSchema: {
        lookahead_days: z.string().optional().describe("How many days ahead to inspect"),
        attendee_or_topic: z.string().optional().describe("Optional attendee, company, or topic to focus on"),
      },
    },
    ({ lookahead_days, attendee_or_topic }) => textPrompt(
      [
        `Prepare a meeting brief for the next ${lookahead_days ?? "7"} days${attendee_or_topic ? ` focused on ${attendee_or_topic}` : ""}.`,
        "Use calendar_list_events for the date window first, then contacts_search for attendee context.",
        "Use mail_query with sender or free-text filters only after the relevant people or topics are identified.",
        "Return agenda context, likely participants, open questions, and recent related messages without reading full mail bodies unless necessary.",
      ].join("\n")
    )
  );

  server.registerPrompt(
    "organize_sender_cleanup",
    {
      title: "Organize Sender Cleanup",
      description: "Safely find messages from a sender and guide a preview-before-confirm cleanup flow.",
      argsSchema: {
        sender: z.string().describe("Exact sender email or @domain to review"),
        folders: z.string().optional().describe("Optional comma-separated folders to scan"),
      },
    },
    ({ sender, folders }) => textPrompt(
      [
        `Review cleanup options for sender ${sender}.`,
        `Use mail_find_by_sender first${folders ? ` with folders ${folders}` : ""} and present a grouped read-only summary.`,
        "If deletion is requested, call mail_bulk_delete_preview and show the returned selection_token, count, folders, and confirmation_phrase.",
        "Only call mail_bulk_delete_confirm after the user repeats the exact confirmation phrase. This flow moves matches to Trash and must not permanently purge mail.",
      ].join("\n")
    )
  );
}

function textPrompt(text: string) {
  return {
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text,
      },
    }],
  };
}
