import type {
  MailAttachment,
  MailboxSummary,
  MailFolder,
  MailListMessagesResult,
  MailReadMessageResult,
  MailSendResult,
  MailToolService,
  MailUid,
  SendMessageParams,
} from "./mail.js";

interface HybridMailServiceOptions {
  api?: Partial<MailToolService>;
  legacy?: Partial<MailToolService>;
}

export class HybridMailService implements MailToolService {
  readonly supportsMailboxes: boolean;

  private readonly api?: Partial<MailToolService>;
  private readonly legacy?: Partial<MailToolService>;

  constructor(options: HybridMailServiceOptions) {
    this.api = options.api;
    this.legacy = options.legacy;
    this.supportsMailboxes = Boolean(options.api?.listMailboxes);
  }

  async listMailboxes(): Promise<MailboxSummary[]> {
    if (!this.api?.listMailboxes) {
      throw new Error("Listing Infomaniak mailboxes requires MAIL_TOKEN or INFOMANIAK_TOKEN with workspace:mail scope.");
    }
    return this.api.listMailboxes();
  }

  async listFolders(mailboxUuid?: string): Promise<MailFolder[]> {
    return this.withApiFallback(
      "list folders",
      () => this.api?.listFolders?.(mailboxUuid),
      () => this.legacy?.listFolders?.(mailboxUuid)
    );
  }

  async listMessages(
    folder: string = "INBOX",
    limit: number = 20,
    page: number = 1,
    mailboxUuid?: string
  ): Promise<MailListMessagesResult> {
    return this.withApiFallback(
      "list messages",
      () => this.api?.listMessages?.(folder, limit, page, mailboxUuid),
      () => this.legacy?.listMessages?.(folder, limit, page, mailboxUuid)
    );
  }

  async readMessage(folder: string, uid: MailUid, mailboxUuid?: string): Promise<MailReadMessageResult> {
    return this.withApiFallback(
      "read message",
      () => this.api?.readMessage?.(folder, uid, mailboxUuid),
      () => this.legacy?.readMessage?.(folder, coerceLegacyUid(uid), mailboxUuid)
    );
  }

  async downloadAttachment(
    folder: string,
    uid: MailUid,
    attachmentIndex: number
  ): Promise<MailAttachment & { contentBase64: string }> {
    const legacy = this.requireLegacy("download attachments");
    return legacy.downloadAttachment(folder, coerceLegacyUid(uid), attachmentIndex);
  }

  async searchMessages(
    folder: string,
    query: string,
    limit: number = 20
  ): Promise<Array<{ uid: MailUid; subject: string; from: string; date: string }>> {
    const legacy = this.requireLegacy("search messages");
    return legacy.searchMessages(folder, query, limit);
  }

  async sendMessage(params: SendMessageParams): Promise<MailSendResult> {
    if (params.attachments?.length) {
      const legacy = this.requireLegacy("send mail with attachments");
      return legacy.sendMessage(params);
    }

    return this.withApiFallback(
      "send message",
      () => this.api?.sendMessage?.(params),
      () => this.legacy?.sendMessage?.(params)
    );
  }

  async moveMessage(folder: string, uid: MailUid, destinationFolder: string): Promise<void> {
    const legacy = this.requireLegacy("move messages");
    await legacy.moveMessage(folder, coerceLegacyUid(uid), destinationFolder);
  }

  async deleteMessage(folder: string, uid: MailUid): Promise<void> {
    const legacy = this.requireLegacy("delete messages");
    await legacy.deleteMessage(folder, coerceLegacyUid(uid));
  }

  async flagMessage(folder: string, uid: MailUid, flags: string[], action: "add" | "remove"): Promise<void> {
    const legacy = this.requireLegacy("flag messages");
    await legacy.flagMessage(folder, coerceLegacyUid(uid), flags, action);
  }

  private async withApiFallback<T>(
    operation: string,
    apiCall: () => Promise<T> | undefined,
    legacyCall: () => Promise<T> | undefined
  ): Promise<T> {
    if (this.api) {
      try {
        const result = apiCall();
        if (result) return await result;
      } catch (error) {
        if (!this.legacy) throw error;
        console.error(`[infomaniak-mcp] Mail API failed to ${operation}; falling back to IMAP/SMTP: ${formatError(error)}`);
      }
    }

    const fallback = legacyCall();
    if (fallback) return fallback;
    throw new Error(`No configured mail backend can ${operation}.`);
  }

  private requireLegacy(operation: string): Required<Pick<
    MailToolService,
    "downloadAttachment" | "searchMessages" | "sendMessage" | "moveMessage" | "deleteMessage" | "flagMessage"
  >> & Partial<MailToolService> {
    if (!this.legacy) {
      throw new Error(`Mail ${operation} currently requires IMAP/SMTP fallback. Set MAIL_USER and MAIL_PASSWORD.`);
    }
    return this.legacy as Required<Pick<
      MailToolService,
      "downloadAttachment" | "searchMessages" | "sendMessage" | "moveMessage" | "deleteMessage" | "flagMessage"
    >> & Partial<MailToolService>;
  }
}

function coerceLegacyUid(uid: MailUid): number {
  if (typeof uid === "number") return uid;
  const parsed = Number(uid);
  if (Number.isInteger(parsed)) return parsed;
  throw new Error(`IMAP fallback requires a numeric UID; received ${uid}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
