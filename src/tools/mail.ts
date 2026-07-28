import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailReadOptions, MailSenderMessage, MailToolService } from "../services/mail.js";
import { safeHandler, textResult, jsonResult, structuredResult, withUntrustedContent, type ToolResult } from "../tool-handler.js";
import { defaultTempResourceRegistry, type TempResourceRegistry } from "../temp-resources.js";
import { requireExternalConfirmation, type ToolRegistrationOptions } from "./register.js";

const uidSchema = z.union([z.number(), z.string()]);
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const mutating = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
const DEFAULT_ATTACHMENT_INLINE_LIMIT = 1024 * 1024;

const senderSearchSchema = {
  sender: z.string().describe("Full sender email address (sender@example.com), or @example.com for a domain-wide sender search"),
  mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
  folders: z.array(z.string()).optional().describe("Optional folder names/paths/roles or folder_id:<id> values to scan. Defaults to INBOX."),
  all_folders: z.boolean().optional().describe("Scan every folder returned by mail_list_folders. Use carefully before destructive previews."),
  limit_per_folder: z.number().int().min(1).max(1000).optional().describe("Maximum newest messages to scan per folder (default: 100, max: 1000)"),
  max_results: z.number().int().min(1).max(1000).optional().describe("Maximum matching messages to return or act on (default: 100, max: 1000)"),
};

const spamCleanupSchema = {
  ...senderSearchSchema,
  block_pattern: z.string().optional().describe("Optional Infomaniak blocked-sender entry. Defaults to the sender, or *@example.com for @example.com domain searches."),
  mark_existing: z.boolean().optional().describe("Also mark matching existing messages as spam. Defaults to false."),
  enable_spam_filter: z.boolean().optional().describe("Also enable automatic movement of spam to the Spam folder. Defaults to false."),
};

const mailMessageSummarySchema = z.object({
  uid: uidSchema,
  subject: z.string(),
  from: z.string(),
  date: z.string(),
  flags: z.array(z.string()),
  size: z.number().optional(),
  preview: z.string().optional(),
  threadUid: uidSchema.optional(),
  messagesCount: z.number().optional(),
  unseenMessages: z.number().optional(),
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
  folderId: z.string().optional(),
  folderPath: z.string().optional(),
});

const mailQueryOutputSchema = {
  mailboxUuid: z.string(),
  mailboxEmail: z.string().optional(),
  folderId: z.string(),
  folderPath: z.string(),
  messages: z.array(mailMessageSummarySchema),
  total: z.number(),
  scannedCount: z.number(),
  nextCursor: z.string().optional(),
};

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

type ToolInputSchema = Record<string, z.ZodTypeAny>;
type ToolOutputSchema = ToolInputSchema | z.ZodTypeAny;
const defaultOutputSchema = z.object({}).passthrough();

function registerMailTool<T extends ToolInputSchema>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: T,
  annotations: ToolAnnotations,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<ToolResult>,
  outputSchema: ToolOutputSchema = defaultOutputSchema
): void {
  server.registerTool(
    name,
    { description, inputSchema, outputSchema, annotations },
    safeHandler(handler as never, { name, annotations }) as never
  );
}

function senderCriteriaFromArgs(args: {
  sender: string;
  mailbox_uuid?: string;
  folders?: string[];
  all_folders?: boolean;
  limit_per_folder?: number;
  max_results?: number;
}) {
  return {
    sender: args.sender,
    mailboxUuid: args.mailbox_uuid,
    folders: args.folders,
    allFolders: args.all_folders,
    limitPerFolder: args.limit_per_folder,
    maxResults: args.max_results,
  };
}

export function registerMailTools(server: McpServer, mail: MailToolService, options: ToolRegistrationOptions & { tempResources?: TempResourceRegistry } = {}) {
  const tempResources = options.tempResources ?? defaultTempResourceRegistry;

  if (mail.supportsMailboxes && mail.listMailboxes) {
    registerMailTool(
      server,
      "mail_list_mailboxes",
      "List Infomaniak mailboxes available to the configured mail API token.",
      {},
      readOnly,
      async () => jsonResult(await mail.listMailboxes!())
    );
  }

  registerMailTool(
    server,
    "mail_list_folders",
    "List all mail folders/mailboxes (INBOX, Sent, Drafts, Trash, etc.)",
    {
      mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
    },
    readOnly,
    async ({ mailbox_uuid }) => jsonResult(await mail.listFolders(mailbox_uuid))
  );

  registerMailTool(
    server,
    "mail_list_messages",
    "List message summaries in a mail folder. Returns UID, subject, sender, date, flags, previews, and counts without fetching full bodies. With the Mail API backend, pass folder as folder_id:<id> to skip folder-name lookup.",
    {
      folder: z.string().optional().describe("Folder path (default: INBOX), or folder_id:<id> for a Mail API folder ID"),
      limit: z.number().int().min(1).max(1000).optional().describe("Messages per page (default: 20)"),
      page: z.number().int().min(1).optional().describe("Page number (default: 1). Prefer mail_query for cursor-based pagination."),
      mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
    },
    readOnly,
    async ({ folder, limit, page, mailbox_uuid }) => jsonResult(await mail.listMessages(folder ?? "INBOX", limit ?? 20, page ?? 1, mailbox_uuid))
  );

  if (mail.queryMessages) {
    registerMailTool(
      server,
      "mail_query",
      "Query message summaries with server-side paging semantics. Returns concise metadata only; use mail_read_message with include_body when a specific message body is needed.",
      {
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
        folder: z.string().optional().describe("Folder path or folder_id:<id>. Defaults to INBOX. Ignored when cursor is provided."),
        query: z.string().optional().describe("Text to match against UID, subject, sender, and preview."),
        sender: z.string().optional().describe("Full sender email or @domain filter."),
        unread: z.boolean().optional().describe("Filter unread/read messages."),
        flagged: z.boolean().optional().describe("Filter starred/flagged messages."),
        has_attachment: z.boolean().optional().describe("Filter messages with attachments when the backend exposes that metadata."),
        date_from: z.string().optional().describe("Inclusive lower date bound, ISO 8601 date or date-time."),
        date_to: z.string().optional().describe("Inclusive upper date bound, ISO 8601 date or date-time."),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum summaries to return (default: 20, max: 100)."),
        cursor: z.string().optional().describe("Opaque nextCursor returned by a previous mail_query call."),
      },
      readOnly,
      async (args) => jsonResult(await mail.queryMessages!({
        mailboxUuid: args.mailbox_uuid,
        folder: args.folder,
        query: args.query,
        sender: args.sender,
        unread: args.unread,
        flagged: args.flagged,
        hasAttachment: args.has_attachment,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        limit: args.limit,
        cursor: args.cursor,
      })),
      mailQueryOutputSchema
    );
  }

  registerMailTool(
    server,
    "mail_read_message",
    "Read one email by UID. Defaults to metadata only; set include_body=true to fetch body text/HTML. With the Mail API backend, pass folder as folder_id:<id> to skip folder-name lookup.",
    {
      folder: z.string().describe("Folder path (e.g. INBOX), or folder_id:<id> for a Mail API folder ID"),
      uid: uidSchema.describe("Message UID"),
      mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      include_body: z.boolean().optional().describe("Fetch and return body content. Defaults to false to keep MCP context small."),
      body_format: z.enum(["text", "html", "both"]).optional().describe("Body format to return when include_body=true. Defaults to text."),
      max_body_chars: z.number().int().min(1).max(200000).optional().describe("Maximum body characters to return when include_body=true. Defaults to 8000."),
      include_headers: z.boolean().optional().describe("Include raw headers when the backend exposes them. Defaults to false."),
      include_thread_context: z.boolean().optional().describe("Include backend thread context when supported. Defaults to false."),
    },
    readOnly,
    async ({ folder, uid, mailbox_uuid, include_body, body_format, max_body_chars, include_headers, include_thread_context }) => {
      const options: MailReadOptions = {
        includeBody: include_body ?? false,
        bodyFormat: body_format ?? "text",
        maxBodyChars: max_body_chars ?? 8000,
        includeHeaders: include_headers ?? false,
        includeThreadContext: include_thread_context ?? false,
      };
      const msg = await mail.readMessage(folder, uid, mailbox_uuid, options);
      const body = msg.text || (msg.html ? "[HTML content available; request body_format=html to view it]" : "(body omitted)");
      const attachmentInfo = msg.attachments.length > 0
        ? `\n\nAttachments:\n${msg.attachments.map((a, index) => `- [${index}] ${a.filename} (${a.contentType}, ${a.size} bytes)`).join("\n")}`
        : "";
      return withUntrustedContent(structuredResult(
        msg as unknown as Record<string, unknown>,
        `Subject: ${msg.subject}\nFrom: ${msg.from}\nTo: ${msg.to.join(", ")}\nCc: ${msg.cc.join(", ")}\nDate: ${msg.date}\nMessage-ID: ${msg.messageId}\n\n${body}${attachmentInfo}`
      ), "mail", ["subject", "from", "to", "cc", "text", "html", "attachments"]);
    }
  );

  registerMailTool(
    server,
    "mail_download_attachment",
    "Download an email attachment by zero-based attachment index. By default saves to a temp file and returns a resource link; set include_base64=true only for small attachments.",
    {
      folder: z.string().describe("Folder path (e.g. INBOX)"),
      uid: uidSchema.describe("Message UID"),
      mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      attachment_index: z.number().int().min(0).describe("Zero-based attachment index from mail_read_message"),
      include_base64: z.boolean().optional().describe("Return base64 inline instead of saving to a temp file. Defaults to false."),
      max_inline_bytes: z.number().int().min(1).max(10 * 1024 * 1024).optional().describe("Maximum attachment size allowed for include_base64=true. Defaults to 1 MiB."),
    },
    readOnly,
    async ({ folder, uid, mailbox_uuid, attachment_index, include_base64, max_inline_bytes }) => {
      const attachment = await mail.downloadAttachment(folder, uid, attachment_index, mailbox_uuid);
      if (include_base64) {
        const maxInlineBytes = max_inline_bytes ?? DEFAULT_ATTACHMENT_INLINE_LIMIT;
        if (attachment.size > maxInlineBytes) {
          throw new Error(`Attachment is ${attachment.size} bytes; max_inline_bytes is ${maxInlineBytes}. Retry without include_base64 to save it as a temp file.`);
        }
        return structuredResult({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          contentBase64: attachment.contentBase64,
        });
      }

      const saved = await saveAttachmentToTempFile(attachment, tempResources);
      return structuredResult(
        {
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          filePath: saved.filePath,
          fileUri: saved.fileUri,
          resourceUri: saved.resourceUri,
        },
        `Attachment saved: ${saved.filePath}`,
        [{
          type: "resource_link",
          uri: saved.resourceUri,
          name: attachment.filename,
          description: `Saved email attachment (${attachment.size} bytes)`,
          mimeType: attachment.contentType,
        }]
      );
    }
  );

  registerMailTool(
    server,
    "mail_search",
    "Search for messages by subject, preview, sender, or UID. Returns matching summaries with UID, subject, sender, and date. Prefer mail_query for cursor-based filtering.",
    {
      folder: z.string().optional().describe("Folder to search (default: INBOX), or folder_id:<id> for a Mail API folder ID"),
      query: z.string().describe("Search query. Mail API backend matches subject, sender, preview, and UID; IMAP fallback also searches body."),
      limit: z.number().int().min(1).max(1000).optional().describe("Max results (default: 20)"),
    },
    readOnly,
    async ({ folder, query, limit }) => jsonResult(await mail.searchMessages(folder ?? "INBOX", query, limit ?? 20))
  );

  if (mail.supportsBulkMailActions && mail.findMessagesBySender && mail.previewBulkDeleteBySender && mail.confirmBulkDeleteBySender) {
    registerMailTool(
      server,
      "mail_find_by_sender",
      "Find messages from a specific sender using the Infomaniak Mail API. Read-only. Returns folder IDs, UIDs, subjects, sender, and dates for use in previews or explicit follow-up actions.",
      senderSearchSchema,
      readOnly,
      async (args) => jsonResult(await mail.findMessagesBySender!(senderCriteriaFromArgs(args)))
    );

    registerMailTool(
      server,
      "mail_bulk_delete_preview",
      "Preview a bulk delete by sender. This does not delete anything. The confirm tool moves the exact matching selection to Trash only if the returned selection_token and confirmation_phrase are supplied unchanged.",
      senderSearchSchema,
      readOnly,
      async (args) => jsonResult(await mail.previewBulkDeleteBySender!(senderCriteriaFromArgs(args)))
    );

    registerMailTool(
      server,
      "mail_bulk_delete_confirm",
      "Confirm a bulk delete preview. Recomputes the sender/folder selection, verifies the selection token, then moves the matching messages to Trash. This never permanently purges mail.",
      {
        ...senderSearchSchema,
        selection_token: z.string().length(64).describe("selection_token returned by mail_bulk_delete_preview"),
        confirmation: z.string().describe("Exact confirmation_phrase returned by mail_bulk_delete_preview, e.g. MOVE 12 MESSAGES FROM sender@example.com TO TRASH"),
      },
      destructive,
      async (args) => jsonResult(await mail.confirmBulkDeleteBySender!({
        ...senderCriteriaFromArgs(args),
        selectionToken: args.selection_token,
        confirmation: args.confirmation,
      }))
    );
  }

  if (mail.supportsSpamControls && mail.getSpamSettings && mail.setSpamFilter && mail.blockSender && mail.unblockSender && mail.markMessagesAsSpam) {
    registerMailTool(
      server,
      "mail_spam_settings",
      "Read spam-related mailbox settings: spam auto-move status plus authorized and blocked senders.",
      {
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      readOnly,
      async ({ mailbox_uuid }) => jsonResult(await mail.getSpamSettings!(mailbox_uuid))
    );

    registerMailTool(
      server,
      "mail_set_spam_filter",
      "Enable or disable automatic movement of spam messages to the Spam folder. Requires exact confirmation: ENABLE SPAM FILTER or DISABLE SPAM FILTER.",
      {
        enabled: z.boolean().describe("true to enable spam auto-move, false to disable it"),
        confirmation: z.string().describe("Exact confirmation phrase: ENABLE SPAM FILTER or DISABLE SPAM FILTER"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      mutating,
      async ({ enabled, confirmation, mailbox_uuid }) => jsonResult(await mail.setSpamFilter!({ enabled, confirmation, mailboxUuid: mailbox_uuid }))
    );

    registerMailTool(
      server,
      "mail_block_sender",
      "Add a sender email address, @domain shorthand, or Infomaniak wildcard pattern to the mailbox blocked senders list and remove it from authorized senders. Requires exact confirmation: BLOCK <normalized-entry>.",
      {
        sender: z.string().describe("Full email address, @domain shorthand, or wildcard pattern to block, e.g. sender@example.com, @example.com, or *@example.com"),
        confirmation: z.string().describe("Exact confirmation phrase, e.g. BLOCK sender@example.com or BLOCK *@example.com"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      mutating,
      async ({ sender, confirmation, mailbox_uuid }) => jsonResult(await mail.blockSender!({ sender, confirmation, mailboxUuid: mailbox_uuid }))
    );

    registerMailTool(
      server,
      "mail_unblock_sender",
      "Remove a sender email address from the mailbox blocked senders list.",
      {
        sender: z.string().describe("Full email address to unblock"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      mutating,
      async ({ sender, mailbox_uuid }) => jsonResult(await mail.unblockSender!({ sender, mailboxUuid: mailbox_uuid }))
    );

    registerMailTool(
      server,
      "mail_mark_spam",
      "Mark explicit message UIDs as spam through the Infomaniak Mail API. Requires exact confirmation: MARK N MESSAGES AS SPAM.",
      {
        uids: z.array(uidSchema).min(1).describe("Message UIDs to mark as spam"),
        confirmation: z.string().describe("Exact confirmation phrase, e.g. MARK 2 MESSAGES AS SPAM"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      destructive,
      async ({ uids, confirmation, mailbox_uuid }) => jsonResult(await mail.markMessagesAsSpam!({ uids, confirmation, mailboxUuid: mailbox_uuid }))
    );

    if (mail.findMessagesBySender) {
      registerMailTool(
        server,
        "mail_spam_cleanup_preview",
        "Preview a spam cleanup. This does not mutate anything. It checks spam settings, finds matching messages, normalizes the block entry, and returns an exact confirmation phrase.",
        spamCleanupSchema,
        readOnly,
        async (args) => jsonResult(await buildSpamCleanupPreview(mail, args))
      );

      registerMailTool(
        server,
        "mail_spam_cleanup_confirm",
        "Confirm a spam cleanup preview. Recomputes the sender selection, verifies the token and exact phrase, blocks the sender/domain, and optionally marks matching existing messages as spam and enables spam auto-move.",
        {
          ...spamCleanupSchema,
          selection_token: z.string().length(64).describe("selectionToken returned by mail_spam_cleanup_preview"),
          confirmation: z.string().describe("Exact confirmationPhrase returned by mail_spam_cleanup_preview"),
        },
        destructive,
        async (args) => jsonResult(await confirmSpamCleanup(mail, args))
      );
    }
  }

  if (mail.supportsMailboxFilters && mail.listMailboxFilters) {
    registerMailTool(
      server,
      "mail_filters_list",
      "List mailbox Sieve filters and scripts through the documented Infomaniak filter API. Read-only.",
      {
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      readOnly,
      async ({ mailbox_uuid }) => jsonResult(await mail.listMailboxFilters!(mailbox_uuid))
    );
  }

  registerMailTool(
    server,
    "mail_send",
    "Send an email message. Supports plain text and/or HTML body, file attachments, CC/BCC, and reply threading.",
    {
      to: z.array(z.string()).describe("Recipient email addresses"),
      subject: z.string().describe("Email subject"),
      text: z.string().optional().describe("Plain text body"),
      html: z.string().optional().describe("HTML body"),
      cc: z.array(z.string()).optional().describe("CC recipients"),
      bcc: z.array(z.string()).optional().describe("BCC recipients"),
      attachments: z.array(z.object({
        filename: z.string().describe("Attachment filename"),
        base64_content: z.string().describe("Base64-encoded attachment content"),
        content_type: z.string().optional().describe("Optional MIME type, e.g. text/plain or application/pdf"),
        content_disposition: z.enum(["attachment", "inline"]).optional().describe("How the attachment should be presented"),
        content_id: z.string().optional().describe("Optional CID for inline HTML attachments"),
      })).optional().describe("Optional attachments to include"),
      reply_to_message_id: z.string().optional().describe("Message-ID to reply to (for threading)"),
      references: z.array(z.string()).optional().describe("Message-ID references chain (for threading)"),
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: SEND MAIL TO <comma-separated recipients>"),
    },
    mutating,
    async ({ to, subject, text, html, cc, bcc, attachments, reply_to_message_id, references, confirmation }) => {
      requireExternalConfirmation(options, confirmation, `SEND MAIL TO ${[...to, ...(cc ?? []), ...(bcc ?? [])].join(",")}`);
      const result = await mail.sendMessage({
        to, subject, text, html, cc, bcc,
        attachments: attachments?.map((attachment) => ({
          filename: attachment.filename,
          base64Content: attachment.base64_content,
          contentType: attachment.content_type,
          contentDisposition: attachment.content_disposition,
          cid: attachment.content_id,
        })),
        inReplyTo: reply_to_message_id,
        references,
      });
      return structuredResult(result as unknown as Record<string, unknown>, `Email sent. Message-ID: ${result.messageId}`);
    }
  );

  if (mail.supportsDrafts && mail.saveDraft) {
    registerMailTool(
      server,
      "mail_save_draft",
      "Save an email draft without sending it. Supports plain text/HTML, CC/BCC, reply threading, and attachments when the configured backend supports draft attachments.",
      {
        to: z.array(z.string()).describe("Draft recipient email addresses"),
        subject: z.string().describe("Draft subject"),
        text: z.string().optional().describe("Plain text body"),
        html: z.string().optional().describe("HTML body"),
        cc: z.array(z.string()).optional().describe("CC recipients"),
        bcc: z.array(z.string()).optional().describe("BCC recipients"),
        attachments: z.array(z.object({
          filename: z.string().describe("Attachment filename"),
          base64_content: z.string().describe("Base64-encoded attachment content"),
          content_type: z.string().optional().describe("Optional MIME type, e.g. text/plain or application/pdf"),
          content_disposition: z.enum(["attachment", "inline"]).optional().describe("How the attachment should be presented"),
          content_id: z.string().optional().describe("Optional CID for inline HTML attachments"),
        })).optional().describe("Optional draft attachments"),
        reply_to_message_id: z.string().optional().describe("Message-ID to reply to (for threading)"),
        references: z.array(z.string()).optional().describe("Message-ID references chain (for threading)"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      mutating,
      async ({ to, subject, text, html, cc, bcc, attachments, reply_to_message_id, references, mailbox_uuid }) => {
        const draftParams = compactObject({
          to,
          subject,
          text,
          html,
          cc,
          bcc,
          attachments: attachments?.map((attachment) => ({
            filename: attachment.filename,
            base64Content: attachment.base64_content,
            contentType: attachment.content_type,
            contentDisposition: attachment.content_disposition,
            cid: attachment.content_id,
          })),
          inReplyTo: reply_to_message_id,
          references,
          mailboxUuid: mailbox_uuid,
        });
        const result = await mail.saveDraft!(draftParams);
        return structuredResult(result as unknown as Record<string, unknown>, `Draft saved. Draft ID: ${result.draftId}`);
      }
    );
  }

  if (mail.supportsFolderManagement && mail.createFolder && mail.renameFolder && mail.deleteFolder) {
    registerMailTool(
      server,
      "mail_create_folder",
      "Create a mail folder. With the Mail API backend, parent_folder may be a name/path/role or folder_id:<id>.",
      {
        name: z.string().describe("New folder name"),
        parent_folder: z.string().optional().describe("Optional parent folder path/name/role or folder_id:<id>"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      mutating,
      async ({ name, parent_folder, mailbox_uuid }) => jsonResult(await mail.createFolder!({
        name,
        parentFolder: parent_folder,
        mailboxUuid: mailbox_uuid,
      }))
    );

    registerMailTool(
      server,
      "mail_rename_folder",
      "Rename a mail folder. With the Mail API backend, folder may be a name/path/role or folder_id:<id>.",
      {
        folder: z.string().describe("Existing folder path/name/role or folder_id:<id>"),
        new_name: z.string().describe("New folder name"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      mutating,
      async ({ folder, new_name, mailbox_uuid }) => jsonResult(await mail.renameFolder!({
        folder,
        newName: new_name,
        mailboxUuid: mailbox_uuid,
      }))
    );

    registerMailTool(
      server,
      "mail_delete_folder",
      "Delete a mail folder. Requires exact confirmation: DELETE MAIL FOLDER <folder>.",
      {
        folder: z.string().describe("Folder path/name/role or folder_id:<id> to delete"),
        confirmation: z.string().describe("Exact confirmation phrase, e.g. DELETE MAIL FOLDER Newsletters"),
        mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
      },
      destructive,
      async ({ folder, confirmation, mailbox_uuid }) => {
        requireMailConfirmation(confirmation, `DELETE MAIL FOLDER ${folder}`);
        await mail.deleteFolder!({
          folder,
          confirmation,
          mailboxUuid: mailbox_uuid,
        });
        return textResult(`Deleted mail folder ${folder}`);
      }
    );
  }

  registerMailTool(
    server,
    "mail_move",
    "Move a message to a different folder.",
    {
      folder: z.string().describe("Current folder"),
      uid: uidSchema.describe("Message UID"),
      destination: z.string().describe("Destination folder path"),
      mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
    },
    destructive,
    async ({ folder, uid, destination, mailbox_uuid }) => {
      await mail.moveMessage(folder, uid, destination, mailbox_uuid);
      return textResult(`Moved message ${uid} from ${folder} to ${destination}`);
    }
  );

  registerMailTool(
    server,
    "mail_delete",
    "Move a message to Trash. The Mail API backend moves to Trash rather than permanently purging.",
    {
      folder: z.string().describe("Folder containing the message"),
      uid: uidSchema.describe("Message UID"),
      mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
    },
    destructive,
    async ({ folder, uid, mailbox_uuid }) => {
      await mail.deleteMessage(folder, uid, mailbox_uuid);
      return textResult(`Moved message ${uid} from ${folder} to Trash`);
    }
  );

  registerMailTool(
    server,
    "mail_flag",
    "Add or remove flags on a message. Common flags: \\Seen (read), \\Flagged (starred), \\Answered (replied), \\Draft",
    {
      folder: z.string().describe("Folder containing the message"),
      uid: uidSchema.describe("Message UID"),
      flags: z.array(z.string()).describe("Flags to add/remove (e.g. [\"\\\\Seen\", \"\\\\Flagged\"])"),
      action: z.enum(["add", "remove"]).describe("Whether to add or remove the flags"),
      mailbox_uuid: z.string().optional().describe("Optional Infomaniak mailbox UUID when using the Mail API backend"),
    },
    mutating,
    async ({ folder, uid, flags, action, mailbox_uuid }) => {
      await mail.flagMessage(folder, uid, flags, action, mailbox_uuid);
      return textResult(`${action === "add" ? "Added" : "Removed"} flags [${flags.join(", ")}] on message ${uid}`);
    }
  );
}

type SpamCleanupArgs = {
  sender: string;
  mailbox_uuid?: string;
  folders?: string[];
  all_folders?: boolean;
  limit_per_folder?: number;
  max_results?: number;
  block_pattern?: string;
  mark_existing?: boolean;
  enable_spam_filter?: boolean;
};

type SpamCleanupConfirmArgs = SpamCleanupArgs & {
  selection_token: string;
  confirmation: string;
};

async function buildSpamCleanupPreview(mail: MailToolService, args: SpamCleanupArgs) {
  if (!mail.findMessagesBySender || !mail.getSpamSettings) {
    throw new Error("Spam cleanup requires Mail API sender search and spam settings support.");
  }

  const senderResult = await mail.findMessagesBySender(senderCriteriaFromArgs(args));
  const settings = await mail.getSpamSettings(senderResult.mailboxUuid);
  const blockPattern = normalizeBlockedSenderEntry(args.block_pattern ?? args.sender);
  const markExisting = args.mark_existing === true;
  const enableSpamFilter = args.enable_spam_filter === true;
  const messagesToMark = markExisting ? senderResult.messages : [];
  const confirmationPhrase = spamCleanupConfirmationPhrase(blockPattern, messagesToMark.length, enableSpamFilter);
  const selectionToken = spamCleanupSelectionToken({
    mailboxUuid: senderResult.mailboxUuid,
    sender: senderResult.sender,
    blockPattern,
    markExisting,
    enableSpamFilter,
    messages: messagesToMark,
  });

  return {
    mailboxUuid: senderResult.mailboxUuid,
    mailboxEmail: senderResult.mailboxEmail,
    sender: senderResult.sender,
    blockPattern,
    alreadyBlocked: settings.blockedSenders.includes(blockPattern),
    spamAutoMoveEnabled: settings.hasMoveSpam === true,
    willEnableSpamFilter: enableSpamFilter && settings.hasMoveSpam !== true,
    markExisting,
    matchedCount: senderResult.count,
    markCount: messagesToMark.length,
    truncated: senderResult.truncated,
    folders: senderResult.scannedFolders,
    messages: senderResult.messages,
    selectionToken,
    confirmationPhrase,
    nextTool: "mail_spam_cleanup_confirm",
    safety: "Preview only. Confirm recomputes the sender selection and requires this token plus exact confirmation before blocking or marking messages.",
  };
}

async function confirmSpamCleanup(mail: MailToolService, args: SpamCleanupConfirmArgs) {
  if (!mail.blockSender || !mail.markMessagesAsSpam || !mail.setSpamFilter) {
    throw new Error("Spam cleanup confirmation requires Mail API spam controls support.");
  }

  const preview = await buildSpamCleanupPreview(mail, args);
  if (!safeStringEquals(args.selection_token, preview.selectionToken)) {
    throw new Error("Spam cleanup selection token no longer matches. Run mail_spam_cleanup_preview again.");
  }
  if (args.confirmation !== preview.confirmationPhrase) {
    throw new Error(`Spam cleanup confirmation must exactly equal: ${preview.confirmationPhrase}`);
  }

  let settings = await mail.blockSender({
    sender: preview.blockPattern,
    confirmation: `BLOCK ${preview.blockPattern}`,
    mailboxUuid: preview.mailboxUuid,
  });

  if (preview.willEnableSpamFilter) {
    settings = await mail.setSpamFilter({
      enabled: true,
      confirmation: "ENABLE SPAM FILTER",
      mailboxUuid: preview.mailboxUuid,
    });
  }

  const uids = preview.markExisting
    ? preview.messages.map((message) => message.uid)
    : [];
  const spamResult = uids.length > 0
    ? await mail.markMessagesAsSpam({
        mailboxUuid: preview.mailboxUuid,
        uids,
        confirmation: `MARK ${uids.length} MESSAGES AS SPAM`,
      })
    : undefined;

  return {
    mailboxUuid: preview.mailboxUuid,
    mailboxEmail: preview.mailboxEmail,
    sender: preview.sender,
    blockPattern: preview.blockPattern,
    blocked: settings.blockedSenders.includes(preview.blockPattern),
    spamAutoMoveEnabled: settings.hasMoveSpam === true,
    markedCount: spamResult?.markedCount ?? 0,
    markedUids: spamResult?.uids ?? [],
    selectionToken: preview.selectionToken,
  };
}

function normalizeBlockedSenderEntry(sender: string): string {
  const normalized = sender.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Sender block entry must not be empty.");
  }
  if (normalized.startsWith("@") && normalized.length > 1 && !normalized.slice(1).includes("@")) {
    return `*${normalized}`;
  }
  if (!normalized.includes("*") && !normalized.includes("?")) {
    if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(normalized)) {
      throw new Error("Sender must be a full email address, @domain shorthand, or Infomaniak wildcard pattern such as *@example.com.");
    }
    return normalized;
  }
  if (!/^[^\s<>]+@[^\s<>]+$/.test(normalized)) {
    throw new Error("Sender block entry must be an email address, @domain shorthand, or Infomaniak wildcard pattern such as *@example.com.");
  }
  return normalized;
}

function spamCleanupConfirmationPhrase(blockPattern: string, markCount: number, enableSpamFilter: boolean): string {
  let phrase = `BLOCK ${blockPattern}`;
  if (markCount > 0) {
    phrase += ` AND MARK ${markCount} MESSAGES AS SPAM`;
  }
  if (enableSpamFilter) {
    phrase += " AND ENABLE SPAM FILTER";
  }
  return phrase;
}

function spamCleanupSelectionToken(input: {
  mailboxUuid: string;
  sender: string;
  blockPattern: string;
  markExisting: boolean;
  enableSpamFilter: boolean;
  messages: MailSenderMessage[];
}): string {
  const messageKeys = input.messages
    .map((message) => `${message.folderId}:${String(message.uid)}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({
      action: "spam_cleanup",
      mailboxUuid: input.mailboxUuid,
      sender: input.sender,
      blockPattern: input.blockPattern,
      markExisting: input.markExisting,
      enableSpamFilter: input.enableSpamFilter,
      messageKeys,
    }))
    .digest("hex");
}

function safeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function saveAttachmentToTempFile(
  attachment: { filename: string; contentBase64: string; contentType?: string },
  tempResources: TempResourceRegistry
): Promise<{ filePath: string; fileUri: string; resourceUri: string }> {
  const directory = join(tmpdir(), "infomaniak-mcp-mail");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const filename = `${randomUUID()}-${sanitizeFilename(attachment.filename)}`;
  const filePath = join(directory, filename);
  await writeFile(filePath, Buffer.from(attachment.contentBase64, "base64"), { mode: 0o600, flag: "wx" });
  const resource = tempResources.addFile({
    filePath,
    name: attachment.filename,
    mimeType: attachment.contentType,
    description: "Saved email attachment",
  });
  return {
    filePath,
    fileUri: `file://${filePath}`,
    resourceUri: resource.uri,
  };
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "attachment";
}

function requireMailConfirmation(actual: string | undefined, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Confirmation must exactly equal: ${expected}`);
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
