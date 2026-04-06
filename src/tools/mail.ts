import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailService } from "../services/mail.js";

export function registerMailTools(server: McpServer, mail: MailService) {
  server.tool(
    "mail_list_folders",
    "List all mail folders/mailboxes",
    {},
    async () => {
      const folders = await mail.listFolders();
      return { content: [{ type: "text", text: JSON.stringify(folders, null, 2) }] };
    }
  );

  server.tool(
    "mail_list_messages",
    "List messages in a mail folder (newest first)",
    {
      folder: z.string().optional().describe("Folder path (default: INBOX)"),
      limit: z.number().optional().describe("Messages per page (default: 20)"),
      page: z.number().optional().describe("Page number (default: 1)"),
    },
    async ({ folder, limit, page }) => {
      const result = await mail.listMessages(folder ?? "INBOX", limit ?? 20, page ?? 1);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "mail_read_message",
    "Read the full content of an email message",
    {
      folder: z.string().describe("Folder path (e.g. INBOX)"),
      uid: z.number().describe("Message UID"),
    },
    async ({ folder, uid }) => {
      const msg = await mail.readMessage(folder, uid);
      // Return text content, fall back to noting HTML is available
      const body = msg.text || (msg.html ? "[HTML content available — body omitted for brevity]" : "(empty)");
      const attachmentInfo = msg.attachments.length > 0
        ? `\n\nAttachments:\n${msg.attachments.map((a) => `- ${a.filename} (${a.contentType}, ${a.size} bytes)`).join("\n")}`
        : "";
      return {
        content: [{
          type: "text",
          text: `Subject: ${msg.subject}\nFrom: ${msg.from}\nTo: ${msg.to.join(", ")}\nCc: ${msg.cc.join(", ")}\nDate: ${msg.date}\n\n${body}${attachmentInfo}`,
        }],
      };
    }
  );

  server.tool(
    "mail_search",
    "Search for messages by subject, body, or sender",
    {
      folder: z.string().optional().describe("Folder to search (default: INBOX)"),
      query: z.string().describe("Search query (matches subject, body, and from)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async ({ folder, query, limit }) => {
      const results = await mail.searchMessages(folder ?? "INBOX", query, limit ?? 20);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    "mail_send",
    "Send an email message",
    {
      to: z.array(z.string()).describe("Recipient email addresses"),
      subject: z.string().describe("Email subject"),
      text: z.string().optional().describe("Plain text body"),
      html: z.string().optional().describe("HTML body"),
      cc: z.array(z.string()).optional().describe("CC recipients"),
      bcc: z.array(z.string()).optional().describe("BCC recipients"),
      reply_to: z.string().optional().describe("Message-ID to reply to"),
    },
    async ({ to, subject, text, html, cc, bcc, reply_to }) => {
      const result = await mail.sendMessage({
        to, subject, text, html, cc, bcc, replyTo: reply_to,
      });
      return { content: [{ type: "text", text: `Email sent. Message-ID: ${result.messageId}` }] };
    }
  );

  server.tool(
    "mail_move",
    "Move a message to a different folder",
    {
      folder: z.string().describe("Current folder"),
      uid: z.number().describe("Message UID"),
      destination: z.string().describe("Destination folder path"),
    },
    async ({ folder, uid, destination }) => {
      await mail.moveMessage(folder, uid, destination);
      return { content: [{ type: "text", text: `Moved message ${uid} from ${folder} to ${destination}` }] };
    }
  );

  server.tool(
    "mail_delete",
    "Delete a message",
    {
      folder: z.string().describe("Folder containing the message"),
      uid: z.number().describe("Message UID"),
    },
    async ({ folder, uid }) => {
      await mail.deleteMessage(folder, uid);
      return { content: [{ type: "text", text: `Deleted message ${uid} from ${folder}` }] };
    }
  );

  server.tool(
    "mail_flag",
    "Add or remove flags on a message (e.g. \\Seen, \\Flagged, \\Answered)",
    {
      folder: z.string().describe("Folder containing the message"),
      uid: z.number().describe("Message UID"),
      flags: z.array(z.string()).describe("Flags to add/remove (e.g. [\"\\\\Seen\", \"\\\\Flagged\"])"),
      action: z.enum(["add", "remove"]).describe("Whether to add or remove the flags"),
    },
    async ({ folder, uid, flags, action }) => {
      await mail.flagMessage(folder, uid, flags, action);
      return { content: [{ type: "text", text: `${action === "add" ? "Added" : "Removed"} flags [${flags.join(", ")}] on message ${uid}` }] };
    }
  );
}
