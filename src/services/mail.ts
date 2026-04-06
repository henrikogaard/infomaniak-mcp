import { ImapFlow, type FetchMessageObject, type MailboxObject } from "imapflow";
import { createTransport, type Transporter } from "nodemailer";
import { simpleParser, type ParsedMail } from "mailparser";
import type { Config } from "../config.js";

export class MailService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private createImapClient(): ImapFlow {
    return new ImapFlow({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: true,
      auth: {
        user: this.config.mailUser,
        pass: this.config.mailPassword,
      },
      logger: false,
    });
  }

  private createSmtpTransport(): Transporter {
    return createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpPort === 465,
      auth: {
        user: this.config.mailUser,
        pass: this.config.mailPassword,
      },
    });
  }

  async listFolders(): Promise<Array<{ name: string; path: string; specialUse?: string; totalMessages?: number }>> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const tree = await client.list();
      return tree.map((folder) => ({
        name: folder.name,
        path: folder.path,
        specialUse: folder.specialUse,
      }));
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async listMessages(
    folder: string = "INBOX",
    limit: number = 20,
    page: number = 1
  ): Promise<{
    messages: Array<{ uid: number; subject: string; from: string; date: string; flags: string[]; size?: number }>;
    total: number;
  }> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const mailbox = await client.mailboxOpen(folder);
      const total = mailbox.exists ?? 0;

      if (total === 0) return { messages: [], total: 0 };

      // Calculate range (newest first)
      const end = Math.max(1, total - (page - 1) * limit);
      const start = Math.max(1, end - limit + 1);
      const range = `${start}:${end}`;

      const messages: Array<{
        uid: number;
        subject: string;
        from: string;
        date: string;
        flags: string[];
        size?: number;
      }> = [];

      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        size: true,
      })) {
        messages.push({
          uid: msg.uid,
          subject: msg.envelope?.subject ?? "(no subject)",
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address ?? ""}>`
            : "(unknown)",
          date: msg.envelope?.date?.toISOString() ?? "",
          flags: Array.from(msg.flags ?? []),
          size: msg.size,
        });
      }

      // Return newest first
      messages.reverse();
      return { messages, total };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async readMessage(
    folder: string,
    uid: number
  ): Promise<{
    subject: string;
    from: string;
    to: string[];
    cc: string[];
    date: string;
    text: string;
    html: string;
    attachments: Array<{ filename: string; contentType: string; size: number }>;
  }> {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxOpen(folder);

      const raw = await client.download(String(uid), undefined, { uid: true });
      const chunks: Buffer[] = [];
      for await (const chunk of raw.content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      const parsed: ParsedMail = await simpleParser(buffer);

      return {
        subject: parsed.subject ?? "(no subject)",
        from: parsed.from?.text ?? "",
        to: Array.isArray(parsed.to)
          ? parsed.to.map((a) => a.text)
          : parsed.to
            ? [parsed.to.text]
            : [],
        cc: Array.isArray(parsed.cc)
          ? parsed.cc.map((a) => a.text)
          : parsed.cc
            ? [parsed.cc.text]
            : [],
        date: parsed.date?.toISOString() ?? "",
        text: parsed.text ?? "",
        html: parsed.html || "",
        attachments: (parsed.attachments ?? []).map((a) => ({
          filename: a.filename ?? "unnamed",
          contentType: a.contentType,
          size: a.size,
        })),
      };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async searchMessages(
    folder: string,
    query: string,
    limit: number = 20
  ): Promise<
    Array<{ uid: number; subject: string; from: string; date: string }>
  > {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxOpen(folder);

      // Search by subject or body containing the query
      const results: Array<{
        uid: number;
        subject: string;
        from: string;
        date: string;
      }> = [];

      // IMAP OR search: subject or body
      for await (const msg of client.fetch(
        { or: [{ subject: query }, { body: query }, { from: query }] },
        { uid: true, envelope: true },
        { uid: false }
      )) {
        results.push({
          uid: msg.uid,
          subject: msg.envelope?.subject ?? "(no subject)",
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address ?? ""}>`
            : "(unknown)",
          date: msg.envelope?.date?.toISOString() ?? "",
        });
        if (results.length >= limit) break;
      }

      results.reverse();
      return results;
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async sendMessage(params: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId: string }> {
    const transport = this.createSmtpTransport();
    const info = await transport.sendMail({
      from: this.config.mailUser,
      to: params.to.join(", "),
      cc: params.cc?.join(", "),
      bcc: params.bcc?.join(", "),
      subject: params.subject,
      text: params.text,
      html: params.html,
      inReplyTo: params.replyTo,
    });
    return { messageId: info.messageId };
  }

  async moveMessage(
    folder: string,
    uid: number,
    destinationFolder: string
  ): Promise<void> {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxOpen(folder);
      await client.messageMove(String(uid), destinationFolder, { uid: true });
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async deleteMessage(folder: string, uid: number): Promise<void> {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxOpen(folder);
      await client.messageDelete(String(uid), { uid: true });
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async flagMessage(
    folder: string,
    uid: number,
    flags: string[],
    action: "add" | "remove"
  ): Promise<void> {
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxOpen(folder);
      if (action === "add") {
        await client.messageFlagsAdd(String(uid), flags, { uid: true });
      } else {
        await client.messageFlagsRemove(String(uid), flags, { uid: true });
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }
}
