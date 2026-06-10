import { ImapFlow } from "imapflow";
import { createTransport, type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { simpleParser, type ParsedMail } from "mailparser";
import type { Config } from "../config.js";

export type MailUid = number | string;

export interface MailAttachment {
  filename: string;
  contentType: string;
  size: number;
}

export interface SendAttachment {
  filename: string;
  base64Content: string;
  contentType?: string;
  contentDisposition?: "attachment" | "inline";
  cid?: string;
}

export interface MailboxSummary {
  uuid: string;
  email: string;
  mailbox: string;
  isPrimary?: boolean;
  hostingId?: number;
}

export interface MailFolder {
  id?: string;
  name: string;
  path: string;
  specialUse?: string;
  role?: string;
  unreadCount?: number;
  totalCount?: number;
}

export interface MailMessageSummary {
  uid: MailUid;
  subject: string;
  from: string;
  date: string;
  flags: string[];
  size?: number;
  preview?: string;
  threadUid?: MailUid;
  messagesCount?: number;
  unseenMessages?: number;
  seen?: boolean;
  flagged?: boolean;
  hasAttachments?: boolean;
  folderId?: string;
  folderPath?: string;
}

export interface MailListMessagesResult {
  messages: MailMessageSummary[];
  total: number;
}

export interface MailReadMessageResult {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  messageId: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
  bcc?: string[];
  preview?: string;
  seen?: boolean;
  flagged?: boolean;
  folder?: unknown;
  headers?: unknown;
}

export interface MailReadOptions {
  includeBody?: boolean;
  bodyFormat?: "text" | "html" | "both";
  maxBodyChars?: number;
  includeHeaders?: boolean;
  includeThreadContext?: boolean;
}

export interface MailQueryParams {
  mailboxUuid?: string;
  folder?: string;
  query?: string;
  sender?: string;
  unread?: boolean;
  flagged?: boolean;
  hasAttachment?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
}

export interface MailQueryResult {
  mailboxUuid: string;
  mailboxEmail?: string;
  folderId: string;
  folderPath: string;
  messages: MailMessageSummary[];
  total: number;
  scannedCount: number;
  nextCursor?: string;
}

export interface SendMessageParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: SendAttachment[];
}

export interface MailSendResult {
  messageId: string;
}

export interface MailSaveDraftParams extends SendMessageParams {
  mailboxUuid?: string;
}

export interface MailDraftResult {
  mailboxUuid: string;
  draftId: string;
  uid?: MailUid;
  resource?: string;
}

export interface MailCreateFolderParams {
  mailboxUuid?: string;
  name: string;
  parentFolder?: string;
}

export interface MailRenameFolderParams {
  mailboxUuid?: string;
  folder: string;
  newName: string;
}

export interface MailDeleteFolderParams {
  mailboxUuid?: string;
  folder: string;
  confirmation: string;
}

export interface MailSenderSearchCriteria {
  sender: string;
  mailboxUuid?: string;
  folders?: string[];
  allFolders?: boolean;
  limitPerFolder?: number;
  maxResults?: number;
}

export interface MailSenderMessage {
  mailboxUuid: string;
  folderId: string;
  folderName: string;
  folderPath: string;
  uid: MailUid;
  subject: string;
  from: string;
  date: string;
  flags: string[];
  preview?: string;
}

export interface MailScannedFolder {
  id: string;
  name: string;
  path: string;
  matchedCount: number;
}

export interface MailSenderSearchResult {
  mailboxUuid: string;
  mailboxEmail: string;
  sender: string;
  count: number;
  truncated: boolean;
  scannedFolders: MailScannedFolder[];
  messages: MailSenderMessage[];
}

export interface MailBulkDeletePreview extends MailSenderSearchResult {
  action: "move_to_trash";
  targetFolderId: string;
  targetFolderPath: string;
  skippedAlreadyInTargetCount: number;
  selectionToken: string;
  confirmationPhrase: string;
}

export interface MailBulkDeleteConfirmParams extends MailSenderSearchCriteria {
  selectionToken: string;
  confirmation: string;
}

export interface MailBulkDeleteResult {
  mailboxUuid: string;
  sender: string;
  movedCount: number;
  skippedAlreadyInTargetCount: number;
  targetFolderId: string;
  targetFolderPath: string;
  uids: string[];
  selectionToken: string;
}

export interface MailMarkSpamParams {
  mailboxUuid?: string;
  uids: MailUid[];
  confirmation: string;
}

export interface MailMarkSpamResult {
  mailboxUuid: string;
  markedCount: number;
  uids: string[];
}

export interface MailSpamSettings {
  mailboxUuid: string;
  mailboxEmail: string;
  mailboxName: string;
  hostingId: number;
  hasMoveSpam?: boolean;
  authorizedSenders: string[];
  blockedSenders: string[];
}

export interface MailSenderRestrictionParams {
  mailboxUuid?: string;
  sender: string;
  confirmation?: string;
}

export interface MailSetSpamFilterParams {
  mailboxUuid?: string;
  enabled: boolean;
  confirmation?: string;
}

export interface MailFilterCondition {
  property: string;
  operator: string;
  value: string;
}

export interface MailFilterAction {
  type: string;
  value?: unknown;
}

export interface MailboxFilter {
  name: string;
  isEnabled: boolean;
  hasAllOf: boolean;
  conditions: MailFilterCondition[];
  actions: MailFilterAction[];
  templateId?: number | null;
}

export interface MailboxFilterScript {
  name: string;
  isEnabled: boolean | string;
  content: string;
}

export interface MailboxFiltersResult {
  mailboxUuid: string;
  mailboxEmail: string;
  preventScript: boolean;
  useScripts: boolean;
  scripts: MailboxFilterScript[];
  filters: MailboxFilter[];
  templates: unknown[];
}

export interface MailToolService {
  supportsMailboxes?: boolean;
  supportsBulkMailActions?: boolean;
  supportsSpamControls?: boolean;
  supportsMailboxFilters?: boolean;
  supportsDrafts?: boolean;
  supportsFolderManagement?: boolean;
  listMailboxes?: () => Promise<MailboxSummary[]>;
  listFolders(mailboxUuid?: string): Promise<MailFolder[]>;
  listMessages(folder?: string, limit?: number, page?: number, mailboxUuid?: string): Promise<MailListMessagesResult>;
  queryMessages?: (params: MailQueryParams) => Promise<MailQueryResult>;
  readMessage(folder: string, uid: MailUid, mailboxUuid?: string, options?: MailReadOptions): Promise<MailReadMessageResult>;
  downloadAttachment(folder: string, uid: MailUid, attachmentIndex: number): Promise<MailAttachment & { contentBase64: string }>;
  searchMessages(folder: string, query: string, limit?: number): Promise<Array<{ uid: MailUid; subject: string; from: string; date: string }>>;
  sendMessage(params: SendMessageParams): Promise<MailSendResult>;
  saveDraft?: (params: MailSaveDraftParams) => Promise<MailDraftResult>;
  createFolder?: (params: MailCreateFolderParams) => Promise<MailFolder>;
  renameFolder?: (params: MailRenameFolderParams) => Promise<MailFolder>;
  deleteFolder?: (params: MailDeleteFolderParams) => Promise<void>;
  moveMessage(folder: string, uid: MailUid, destinationFolder: string, mailboxUuid?: string): Promise<void>;
  deleteMessage(folder: string, uid: MailUid, mailboxUuid?: string): Promise<void>;
  flagMessage(folder: string, uid: MailUid, flags: string[], action: "add" | "remove", mailboxUuid?: string): Promise<void>;
  findMessagesBySender?: (criteria: MailSenderSearchCriteria) => Promise<MailSenderSearchResult>;
  previewBulkDeleteBySender?: (criteria: MailSenderSearchCriteria) => Promise<MailBulkDeletePreview>;
  confirmBulkDeleteBySender?: (params: MailBulkDeleteConfirmParams) => Promise<MailBulkDeleteResult>;
  markMessagesAsSpam?: (params: MailMarkSpamParams) => Promise<MailMarkSpamResult>;
  getSpamSettings?: (mailboxUuid?: string) => Promise<MailSpamSettings>;
  setSpamFilter?: (params: MailSetSpamFilterParams) => Promise<MailSpamSettings>;
  blockSender?: (params: MailSenderRestrictionParams) => Promise<MailSpamSettings>;
  unblockSender?: (params: MailSenderRestrictionParams) => Promise<MailSpamSettings>;
  listMailboxFilters?: (mailboxUuid?: string) => Promise<MailboxFiltersResult>;
}

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
      logger: {
        debug: () => {},
        info: () => {},
        warn: (msg: unknown) => console.error("[IMAP warn]", msg),
        error: (msg: unknown) => console.error("[IMAP error]", msg),
      },
      tls: {
        rejectUnauthorized: true,
      },
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

  async listFolders(): Promise<MailFolder[]> {
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
  ): Promise<MailListMessagesResult> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const mailbox = await client.mailboxOpen(folder);
      const total = mailbox.exists ?? 0;

      if (total === 0) return { messages: [], total: 0 };

      // Calculate range (newest first by sequence number)
      const end = Math.max(1, total - (page - 1) * limit);
      const start = Math.max(1, end - limit + 1);
      const range = `${start}:${end}`;

      const messages: MailMessageSummary[] = [];

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
    uid: number,
    _mailboxUuid?: string,
    options: MailReadOptions = {}
  ): Promise<MailReadMessageResult> {
    const parsed = await this.getParsedMessage(folder, uid);
    const includeBody = options.includeBody ?? true;
    const bodyFormat = options.bodyFormat ?? "both";
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
      messageId: parsed.messageId ?? "",
      text: includeBody && bodyFormat !== "html" ? truncateBody(parsed.text ?? "", options.maxBodyChars) : "",
      html: includeBody && bodyFormat !== "text" ? truncateBody(parsed.html || "", options.maxBodyChars) : "",
      attachments: summarizeAttachments(parsed),
    };
  }

  async downloadAttachment(
    folder: string,
    uid: number,
    attachmentIndex: number
  ): Promise<MailAttachment & { contentBase64: string }> {
    const parsed = await this.getParsedMessage(folder, uid);
    const attachments = parsed.attachments ?? [];
    const target = attachments[attachmentIndex];

    if (!target) {
      throw new Error(
        `Attachment index ${attachmentIndex} not found. Message has ${attachments.length} attachment(s).`
      );
    }

    const content = target.content;
    if (!content) {
      throw new Error(`Attachment ${attachmentIndex} has no downloadable content.`);
    }

    return {
      filename: target.filename ?? "unnamed",
      contentType: target.contentType,
      size: target.size,
      contentBase64: content.toString("base64"),
    };
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

      // Use IMAP SEARCH to find matching UIDs first, then fetch envelopes
      const uids = await client.search(
        { or: [{ subject: query }, { body: query }, { from: query }] },
        { uid: true }
      );

      if (!uids || uids.length === 0) return [];

      // Take the last N UIDs (newest messages)
      const targetUids = uids.slice(-limit);

      const results: Array<{
        uid: number;
        subject: string;
        from: string;
        date: string;
      }> = [];

      for await (const msg of client.fetch(targetUids.join(","), {
        uid: true,
        envelope: true,
      }, { uid: true })) {
        results.push({
          uid: msg.uid,
          subject: msg.envelope?.subject ?? "(no subject)",
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address ?? ""}>`
            : "(unknown)",
          date: msg.envelope?.date?.toISOString() ?? "",
        });
      }

      // Newest first
      results.reverse();
      return results;
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async sendMessage(params: SendMessageParams): Promise<MailSendResult> {
    const transport = this.createSmtpTransport();
    const info = await transport.sendMail({
      from: this.config.mailUser,
      to: params.to.join(", "),
      cc: params.cc?.join(", "),
      bcc: params.bcc?.join(", "),
      subject: params.subject,
      text: params.text,
      html: params.html,
      inReplyTo: params.inReplyTo,
      references: params.references?.join(" "),
      attachments: params.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.base64Content, "base64"),
        contentType: attachment.contentType,
        contentDisposition: attachment.contentDisposition,
        cid: attachment.cid,
      })),
    });
    return { messageId: info.messageId };
  }

  async saveDraft(params: MailSaveDraftParams): Promise<MailDraftResult> {
    const client = this.createImapClient();
    try {
      await client.connect();
      const folders = await client.list();
      const draftFolder = folders.find((folder) =>
        folder.specialUse?.toLowerCase() === "\\drafts" ||
        folder.path.toLowerCase() === "drafts" ||
        folder.name.toLowerCase() === "drafts"
      );
      const draftPath = draftFolder?.path ?? "Drafts";
      const rawMessage = await buildRawDraftMessage(this.config.mailUser, params);
      const appended = await client.append(draftPath, rawMessage, ["\\Draft"], new Date());
      return {
        mailboxUuid: "legacy",
        draftId: appended && "uid" in appended ? String(appended.uid ?? "") : "",
        uid: appended && "uid" in appended ? appended.uid : undefined,
        resource: draftPath,
      };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async createFolder(params: MailCreateFolderParams): Promise<MailFolder> {
    const path = params.parentFolder ? `${params.parentFolder.replace(/\/+$/, "")}/${params.name}` : params.name;
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxCreate(path);
      return { name: params.name, path };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async renameFolder(params: MailRenameFolderParams): Promise<MailFolder> {
    const newPath = parentPath(params.folder)
      ? `${parentPath(params.folder)}/${params.newName}`
      : params.newName;
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxRename(params.folder, newPath);
      return { name: params.newName, path: newPath };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async deleteFolder(params: MailDeleteFolderParams): Promise<void> {
    const expected = `DELETE MAIL FOLDER ${params.folder}`;
    if (params.confirmation !== expected) {
      throw new Error(`Folder delete confirmation must exactly equal: ${expected}`);
    }
    const client = this.createImapClient();
    try {
      await client.connect();
      await client.mailboxDelete(params.folder);
    } finally {
      await client.logout().catch(() => {});
    }
  }

  private async getParsedMessage(folder: string, uid: number): Promise<ParsedMail> {
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
      return await simpleParser(buffer);
    } finally {
      await client.logout().catch(() => {});
    }
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

function summarizeAttachments(parsed: ParsedMail): MailAttachment[] {
  return (parsed.attachments ?? []).map((attachment) => ({
    filename: attachment.filename ?? "unnamed",
    contentType: attachment.contentType,
    size: attachment.size,
  }));
}

function truncateBody(value: string, maxChars?: number): string {
  if (!maxChars || maxChars < 1 || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated to ${maxChars} characters]`;
}

async function buildRawDraftMessage(from: string, params: SendMessageParams): Promise<Buffer> {
  const composer = new MailComposer({
    from,
    to: params.to.join(", "),
    cc: params.cc?.join(", "),
    bcc: params.bcc?.join(", "),
    subject: params.subject,
    text: params.text,
    html: params.html,
    inReplyTo: params.inReplyTo,
    references: params.references?.join(" "),
    attachments: params.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.base64Content, "base64"),
      contentType: attachment.contentType,
      contentDisposition: attachment.contentDisposition,
      cid: attachment.cid,
    })),
  });
  return composer.compile().build();
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}
