import type {
  MailAttachment,
  MailBulkDeleteConfirmParams,
  MailBulkDeletePreview,
  MailBulkDeleteResult,
  MailCreateFolderParams,
  MailDeleteFolderParams,
  MailDraftResult,
  MailboxSummary,
  MailboxFiltersResult,
  MailMarkSpamParams,
  MailMarkSpamResult,
  MailFolder,
  MailListMessagesResult,
  MailQueryParams,
  MailQueryResult,
  MailReadOptions,
  MailReadMessageResult,
  MailRenameFolderParams,
  MailSaveDraftParams,
  MailSendResult,
  MailSenderRestrictionParams,
  MailSenderSearchCriteria,
  MailSenderSearchResult,
  MailSetSpamFilterParams,
  MailSpamSettings,
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
  readonly supportsBulkMailActions: boolean;
  readonly supportsSpamControls: boolean;
  readonly supportsMailboxFilters: boolean;
  readonly supportsDrafts: boolean;
  readonly supportsFolderManagement: boolean;

  private readonly api?: Partial<MailToolService>;
  private readonly legacy?: Partial<MailToolService>;

  constructor(options: HybridMailServiceOptions) {
    this.api = options.api;
    this.legacy = options.legacy;
    this.supportsMailboxes = Boolean(options.api?.listMailboxes);
    this.supportsBulkMailActions = Boolean(options.api?.findMessagesBySender && options.api?.previewBulkDeleteBySender && options.api?.confirmBulkDeleteBySender);
    this.supportsSpamControls = Boolean(options.api?.getSpamSettings && options.api?.blockSender && options.api?.markMessagesAsSpam);
    this.supportsMailboxFilters = Boolean(options.api?.listMailboxFilters);
    this.supportsDrafts = Boolean(options.api?.saveDraft || options.legacy?.saveDraft);
    this.supportsFolderManagement = Boolean(
      (options.api?.createFolder && options.api?.renameFolder && options.api?.deleteFolder) ||
      (options.legacy?.createFolder && options.legacy?.renameFolder && options.legacy?.deleteFolder)
    );
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

  async queryMessages(params: MailQueryParams): Promise<MailQueryResult> {
    return this.withApiFallback(
      "query messages",
      () => this.api?.queryMessages?.(params),
      async () => {
        const legacy = this.requireLegacy("query messages");
        const folder = params.folder ?? "INBOX";
        const limit = params.limit ?? 20;
        const messages = params.query
          ? await legacy.searchMessages(folder, params.query, limit)
          : (await legacy.listMessages(folder, limit, 1)).messages;
        return {
          mailboxUuid: "legacy",
          folderId: folder,
          folderPath: folder,
          messages: messages.map((message) => {
            const flags = (message as unknown as { flags?: unknown }).flags;
            return {
              ...message,
              flags: Array.isArray(flags) ? flags.filter((flag): flag is string => typeof flag === "string") : [],
            };
          }),
          total: messages.length,
          scannedCount: messages.length,
        };
      }
    );
  }

  async readMessage(folder: string, uid: MailUid, mailboxUuid?: string, options?: MailReadOptions): Promise<MailReadMessageResult> {
    return this.withApiFallback(
      "read message",
      () => this.api?.readMessage?.(folder, uid, mailboxUuid, options),
      () => this.legacy?.readMessage?.(folder, coerceLegacyUid(uid), mailboxUuid, options)
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
    return this.withApiFallback(
      "search messages",
      () => this.api?.searchMessages?.(folder, query, limit),
      () => this.legacy?.searchMessages?.(folder, query, limit)
    );
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

  async saveDraft(params: MailSaveDraftParams): Promise<MailDraftResult> {
    if (params.attachments?.length && this.legacy?.saveDraft) {
      return this.legacy.saveDraft(params);
    }

    return this.withApiFallback(
      "save draft",
      () => this.api?.saveDraft?.(params),
      () => this.legacy?.saveDraft?.(params)
    );
  }

  async createFolder(params: MailCreateFolderParams): Promise<MailFolder> {
    return this.withApiFallback(
      "create folders",
      () => this.api?.createFolder?.(params),
      () => this.legacy?.createFolder?.(params)
    );
  }

  async renameFolder(params: MailRenameFolderParams): Promise<MailFolder> {
    return this.withApiFallback(
      "rename folders",
      () => this.api?.renameFolder?.(params),
      () => this.legacy?.renameFolder?.(params)
    );
  }

  async deleteFolder(params: MailDeleteFolderParams): Promise<void> {
    return this.withApiFallback(
      "delete folders",
      () => this.api?.deleteFolder?.(params),
      () => this.legacy?.deleteFolder?.(params)
    );
  }

  async moveMessage(folder: string, uid: MailUid, destinationFolder: string): Promise<void> {
    return this.withApiFallback(
      "move messages",
      () => this.api?.moveMessage?.(folder, uid, destinationFolder),
      async () => {
        const legacy = this.requireLegacy("move messages");
        await legacy.moveMessage(folder, coerceLegacyUid(uid), destinationFolder);
      }
    );
  }

  async deleteMessage(folder: string, uid: MailUid): Promise<void> {
    return this.withApiFallback(
      "delete messages",
      () => this.api?.deleteMessage?.(folder, uid),
      async () => {
        const legacy = this.requireLegacy("delete messages");
        await legacy.deleteMessage(folder, coerceLegacyUid(uid));
      }
    );
  }

  async flagMessage(folder: string, uid: MailUid, flags: string[], action: "add" | "remove"): Promise<void> {
    return this.withApiFallback(
      "flag messages",
      () => this.api?.flagMessage?.(folder, uid, flags, action),
      async () => {
        const legacy = this.requireLegacy("flag messages");
        await legacy.flagMessage(folder, coerceLegacyUid(uid), flags, action);
      }
    );
  }

  async findMessagesBySender(criteria: MailSenderSearchCriteria): Promise<MailSenderSearchResult> {
    const api = this.requireApi("find messages by sender");
    return api.findMessagesBySender!(criteria);
  }

  async previewBulkDeleteBySender(criteria: MailSenderSearchCriteria): Promise<MailBulkDeletePreview> {
    const api = this.requireApi("preview bulk mail delete");
    return api.previewBulkDeleteBySender!(criteria);
  }

  async confirmBulkDeleteBySender(params: MailBulkDeleteConfirmParams): Promise<MailBulkDeleteResult> {
    const api = this.requireApi("confirm bulk mail delete");
    return api.confirmBulkDeleteBySender!(params);
  }

  async markMessagesAsSpam(params: MailMarkSpamParams): Promise<MailMarkSpamResult> {
    const api = this.requireApi("mark messages as spam");
    return api.markMessagesAsSpam!(params);
  }

  async getSpamSettings(mailboxUuid?: string): Promise<MailSpamSettings> {
    const api = this.requireApi("read spam settings");
    return api.getSpamSettings!(mailboxUuid);
  }

  async setSpamFilter(params: MailSetSpamFilterParams): Promise<MailSpamSettings> {
    const api = this.requireApi("set spam filter");
    return api.setSpamFilter!(params);
  }

  async blockSender(params: MailSenderRestrictionParams): Promise<MailSpamSettings> {
    const api = this.requireApi("block senders");
    return api.blockSender!(params);
  }

  async unblockSender(params: MailSenderRestrictionParams): Promise<MailSpamSettings> {
    const api = this.requireApi("unblock senders");
    return api.unblockSender!(params);
  }

  async listMailboxFilters(mailboxUuid?: string): Promise<MailboxFiltersResult> {
    const api = this.requireApi("list mailbox filters");
    return api.listMailboxFilters!(mailboxUuid);
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
    "downloadAttachment" | "listMessages" | "searchMessages" | "sendMessage" | "moveMessage" | "deleteMessage" | "flagMessage"
  >> & Partial<MailToolService> {
    if (!this.legacy) {
      throw new Error(`Mail ${operation} currently requires IMAP/SMTP fallback. Set MAIL_USER and MAIL_PASSWORD.`);
    }
    return this.legacy as Required<Pick<
      MailToolService,
      "downloadAttachment" | "listMessages" | "searchMessages" | "sendMessage" | "moveMessage" | "deleteMessage" | "flagMessage"
    >> & Partial<MailToolService>;
  }

  private requireApi(operation: string): Partial<MailToolService> {
    if (!this.api) {
      throw new Error(`Mail ${operation} requires the Infomaniak Mail API backend. Set MAIL_TOKEN or INFOMANIAK_TOKEN with workspace:mail scope.`);
    }
    return this.api;
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
