import { createHash, timingSafeEqual } from "node:crypto";
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
  MailFilterAction,
  MailFilterCondition,
  MailMarkSpamParams,
  MailMarkSpamResult,
  MailFolder,
  MailListMessagesResult,
  MailMessageSummary,
  MailQueryParams,
  MailQueryResult,
  MailReadOptions,
  MailReadMessageResult,
  MailRenameFolderParams,
  MailSaveDraftParams,
  MailSendResult,
  MailSenderMessage,
  MailSenderRestrictionParams,
  MailSenderSearchCriteria,
  MailSenderSearchResult,
  MailSetSpamFilterParams,
  MailSpamSettings,
  MailToolService,
  MailUid,
  SendMessageParams,
} from "./mail.js";
import { ThrottledHttpClient, type HttpFetch } from "./http-client.js";

interface ApiResponse<T> {
  result?: string;
  data?: T;
}

interface MailApiServiceOptions {
  token: string;
  baseUrl?: string;
  fetch?: HttpFetch;
  maxConcurrent?: number;
  timeoutMs?: number;
  retries?: number;
}

interface RawMailbox {
  uuid: string;
  email?: string;
  mailbox?: string;
  is_primary?: boolean;
  hosting_id?: number;
}

interface RawFolder {
  id?: string | number;
  name?: string;
  separator?: string;
  role?: string;
  unread_count?: number;
  total_count?: number;
  children?: RawFolder[];
}

interface RawAddress {
  name?: string;
  email?: string;
}

interface RawThreadMessage {
  uid?: MailUid;
  preview?: string;
  flags?: string[];
  seen?: boolean;
  flagged?: boolean;
  has_attachments?: boolean;
}

interface RawThread {
  uid?: MailUid;
  subject?: string;
  from?: RawAddress[];
  date?: string;
  messages_count?: number;
  unseen_messages?: number;
  seen?: boolean;
  flagged?: boolean;
  has_attachments?: boolean;
  messages?: RawThreadMessage[];
}

interface RawMessage {
  uid?: MailUid;
  msg_id?: string;
  message_id?: string;
  subject?: string;
  from?: RawAddress[];
  to?: RawAddress[];
  cc?: RawAddress[];
  bcc?: RawAddress[];
  date?: string;
  body?: string;
  html?: string;
  preview?: string;
  has_attachments?: boolean;
  attachments?: RawAttachment[];
  seen?: boolean;
  flagged?: boolean;
  folder?: unknown;
  headers?: unknown;
}

interface RawAttachment {
  id?: string;
  part_id?: string | number;
  resource?: string;
  filename?: string;
  name?: string;
  content_type?: string;
  mime_type?: string;
  contentType?: string;
  size?: number;
}

interface RawSenderRestriction {
  email?: string;
}

interface RawSpamSettings {
  authorized_senders?: Array<RawSenderRestriction | string>;
  blocked_senders?: Array<RawSenderRestriction | string>;
  has_move_spam?: boolean;
}

interface RawMailboxFilter {
  name?: string;
  is_enabled?: boolean;
  has_all_of?: boolean;
  conditions?: MailFilterCondition[];
  actions?: MailFilterAction[];
  template_id?: number | null;
}

interface RawMailboxFilterScript {
  name?: string;
  is_enabled?: boolean | string;
  content?: string;
}

interface RawMailboxFilters {
  prevent_script?: boolean;
  use_scripts?: boolean;
  scripts?: RawMailboxFilterScript[];
  filters?: RawMailboxFilter[];
  templates?: unknown[];
}

const DEFAULT_API_BASE = "https://mail.infomaniak.com/api";
const MAIL_API_BATCH_LIMIT = 1000;
const MAIL_QUERY_CURSOR_VERSION = 1;
const DEFAULT_FOLDER_SCAN_CONCURRENCY = 4;
const MAX_MAIL_API_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class MailApiService implements Partial<MailToolService> {
  readonly supportsMailboxes = true;
  readonly supportsBulkMailActions = true;
  readonly supportsSpamControls = true;
  readonly supportsMailboxFilters = true;
  readonly supportsDrafts = true;
  readonly supportsFolderManagement = true;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly http: ThrottledHttpClient;
  private defaultMailbox: MailboxSummary | null = null;
  private mailboxCache: { mailboxes: MailboxSummary[]; expiresAt: number } | null = null;
  private mailboxListPromise: Promise<MailboxSummary[]> | null = null;
  private readonly folderCache = new Map<string, { folders: MailFolder[]; expiresAt: number }>();
  private readonly folderListPromises = new Map<string, Promise<MailFolder[]>>();
  private readonly mailboxCacheMs = 60_000;
  private readonly folderCacheMs = 60_000;

  constructor(options: MailApiServiceOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
    this.http = new ThrottledHttpClient({
      fetch: options.fetch,
      maxConcurrent: options.maxConcurrent ?? 4,
      retries: options.retries ?? 2,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
  }

  async listMailboxes(): Promise<MailboxSummary[]> {
    if (this.mailboxCache && this.mailboxCache.expiresAt > Date.now()) {
      return this.mailboxCache.mailboxes;
    }
    if (this.mailboxListPromise) {
      return this.mailboxListPromise;
    }

    this.mailboxListPromise = this.fetchMailboxes();
    try {
      return await this.mailboxListPromise;
    } finally {
      this.mailboxListPromise = null;
    }
  }

  async listFolders(mailboxUuid?: string): Promise<MailFolder[]> {
    const uuid = await this.resolveMailboxUuid(mailboxUuid);
    const cached = this.folderCache.get(uuid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.folders;
    }
    const inflight = this.folderListPromises.get(uuid);
    if (inflight) {
      return inflight;
    }

    const request = this.fetchFolders(uuid);
    this.folderListPromises.set(uuid, request);
    try {
      return await request;
    } finally {
      this.folderListPromises.delete(uuid);
    }
  }

  async listMessages(
    folder: string = "INBOX",
    limit: number = 20,
    page: number = 1,
    mailboxUuid?: string
  ): Promise<MailListMessagesResult> {
    const uuid = await this.resolveMailboxUuid(mailboxUuid);
    const folderId = await this.resolveFolderId(uuid, folder);
    const safeLimit = clampInt(limit, 1, 1000);
    const offset = Math.max(0, (Math.max(1, page) - 1) * safeLimit);
    return this.listMessagesAtOffset(uuid, folderId, safeLimit, offset);
  }

  async queryMessages(params: MailQueryParams): Promise<MailQueryResult> {
    const cursor = params.cursor ? decodeMailQueryCursor(params.cursor) : undefined;
    const mailbox = await this.resolveMailbox(params.mailboxUuid ?? cursor?.mailboxUuid);
    const limit = clampInt(params.limit ?? cursor?.limit ?? 20, 1, 100);
    const filters = cursor?.filters ?? normalizeQueryFilters(params);
    const folderRef = cursor
      ? { id: cursor.folderId, path: cursor.folderPath }
      : await this.resolveFolderRef(mailbox.uuid, params.folder ?? "INBOX");

    const pageSize = Math.max(20, Math.min(100, limit * 4));
    let offset = cursor?.anchorDate ? 0 : cursor?.offset ?? 0;
    let total = Number.POSITIVE_INFINITY;
    let scannedCount = 0;
    let stoppedWithMoreMatches = false;
    let anchorDate = cursor?.anchorDate;
    const seenMessageKeys = new Set(cursor?.seenMessageKeys ?? []);
    const messages: MailMessageSummary[] = [];

    while (messages.length < limit && offset < total) {
      const batch = await this.listMessagesAtOffset(mailbox.uuid, folderRef.id, pageSize, offset);
      total = batch.total;
      scannedCount += batch.messages.length;
      anchorDate ??= batch.messages[0]?.date;

      for (const message of batch.messages) {
        const enriched = { ...message, folderId: folderRef.id, folderPath: folderRef.path };
        const key = mailMessageKey(enriched);
        if (anchorDate && isAfterAnchor(enriched.date, anchorDate)) {
          continue;
        }
        if (seenMessageKeys.has(key)) {
          continue;
        }
        if (matchesQueryFilters(enriched, filters)) {
          if (messages.length >= limit) {
            stoppedWithMoreMatches = true;
            break;
          }
          messages.push(enriched);
          seenMessageKeys.add(key);
        }
      }

      if (batch.messages.length === 0) break;
      offset += pageSize;
      if (messages.length >= limit) break;
    }

    const nextCursor = (stoppedWithMoreMatches || offset < total)
      ? encodeMailQueryCursor({
          version: MAIL_QUERY_CURSOR_VERSION,
          mailboxUuid: mailbox.uuid,
          folderId: folderRef.id,
          folderPath: folderRef.path,
          offset,
          limit,
          filters,
          anchorDate,
          seenMessageKeys: [...seenMessageKeys],
        })
      : undefined;

    return {
      mailboxUuid: mailbox.uuid,
      mailboxEmail: mailbox.email,
      folderId: folderRef.id,
      folderPath: folderRef.path,
      messages,
      total: Number.isFinite(total) ? total : messages.length,
      scannedCount,
      nextCursor,
    };
  }

  async readMessage(
    folder: string,
    uid: MailUid,
    mailboxUuid?: string,
    options: MailReadOptions = {}
  ): Promise<MailReadMessageResult> {
    const uuid = await this.resolveMailboxUuid(mailboxUuid);
    const folderId = await this.resolveFolderId(uuid, folder);
    const includeThreadContext = options.includeThreadContext ?? true;
    const includeHeaders = options.includeHeaders ?? true;
    const includeBody = options.includeBody ?? true;
    const bodyFormat = options.bodyFormat ?? "both";
    const preferredFormat = bodyFormat === "text" ? "plain" : "html";
    const withValues = ["auto_uncrypt", ...(includeThreadContext ? ["thread_context"] : [])];
    const response = await this.apiRequest<RawMessage>(
      `/mail/${encodeURIComponent(uuid)}/folder/${encodeURIComponent(folderId)}/message/${encodeURIComponent(toApiMessageId(uid))}?prefered_format=${preferredFormat}&with=${withValues.join(",")}`
    );
    const message = response.data ?? {};
    return {
      subject: message.subject ?? "(no subject)",
      from: formatAddresses(message.from),
      to: formatAddressList(message.to),
      cc: formatAddressList(message.cc),
      bcc: formatAddressList(message.bcc),
      date: message.date ?? "",
      messageId: message.msg_id ?? message.message_id ?? String(message.uid ?? ""),
      text: includeBody && bodyFormat !== "html" ? truncateBody(message.body ?? "", options.maxBodyChars) : "",
      html: includeBody && bodyFormat !== "text" ? truncateBody(message.html ?? "", options.maxBodyChars) : "",
      attachments: summarizeApiAttachments(message),
      preview: message.preview,
      seen: message.seen,
      flagged: message.flagged,
      folder: message.folder,
      headers: includeHeaders ? message.headers : undefined,
    };
  }

  async downloadAttachment(
    folder: string,
    uid: MailUid,
    attachmentIndex: number,
    mailboxUuid?: string
  ): Promise<MailAttachment & { contentBase64: string }> {
    const message = await this.readMessage(folder, uid, mailboxUuid, {
      includeBody: false,
      includeHeaders: false,
      includeThreadContext: false,
    });
    const attachment = message.attachments[attachmentIndex];
    if (!attachment) {
      throw new Error(`Attachment index ${attachmentIndex} not found. Message has ${message.attachments.length} attachment(s).`);
    }
    if (!attachment.id) {
      throw new Error(`Attachment index ${attachmentIndex} has no Mail API attachment ID.`);
    }

    const uuid = await this.resolveMailboxUuid(mailboxUuid);
    const folderId = await this.resolveFolderId(uuid, folder);
    const raw = await this.downloadRaw(
      `/mail/${encodeURIComponent(uuid)}/folder/${encodeURIComponent(folderId)}/message/${encodeURIComponent(toApiMessageId(uid))}/attachment/${encodeURIComponent(attachment.id)}`
    );
    const filename = parseContentDispositionFilename(raw.headers.get("content-disposition")) ?? attachment.filename;
    const contentType = (raw.headers.get("content-type") ?? attachment.contentType).split(";", 1)[0].trim();

    return {
      id: attachment.id,
      filename,
      contentType,
      size: raw.bytes.length,
      resource: attachment.resource,
      contentBase64: Buffer.from(raw.bytes).toString("base64"),
    };
  }

  async searchMessages(
    folder: string,
    query: string,
    limit: number = 20
  ): Promise<Array<{ uid: MailUid; subject: string; from: string; date: string }>> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const pageSize = Math.max(1, Math.min(Math.max(limit, 20), 100));
    const results: Array<{ uid: MailUid; subject: string; from: string; date: string }> = [];
    let page = 1;
    let scanned = 0;
    let total = Number.POSITIVE_INFINITY;

    while (results.length < limit && scanned < total && page <= 10) {
      const batch = await this.listMessages(folder, pageSize, page);
      scanned += batch.messages.length;
      total = batch.total;

      for (const message of batch.messages) {
        if (messageMatchesQuery(message, normalizedQuery)) {
          results.push({
            uid: message.uid,
            subject: message.subject,
            from: message.from,
            date: message.date,
          });
          if (results.length >= limit) {
            break;
          }
        }
      }

      if (batch.messages.length === 0) {
        break;
      }
      page += 1;
    }

    return results;
  }

  async findMessagesBySender(criteria: MailSenderSearchCriteria): Promise<MailSenderSearchResult> {
    const sender = normalizeSenderCriteria(criteria.sender);
    const mailbox = await this.resolveMailbox(criteria.mailboxUuid);
    const folders = await this.resolveSearchFolders(mailbox.uuid, criteria);
    const maxResults = clampInt(criteria.maxResults ?? 100, 1, 1000);
    const limitPerFolder = clampInt(criteria.limitPerFolder ?? 100, 1, 1000);
    const folderResults = await mapWithConcurrency(folders, DEFAULT_FOLDER_SCAN_CONCURRENCY, async (folder) => {
      const folderMatches = await this.findMessagesBySenderInFolder(
        mailbox.uuid,
        folder,
        sender,
        limitPerFolder,
        maxResults
      );
      return {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        matchedCount: folderMatches.length,
        messages: folderMatches,
      };
    });
    const allMessages = folderResults.flatMap((result) => result.messages);
    const messages = allMessages.slice(0, maxResults);

    return {
      mailboxUuid: mailbox.uuid,
      mailboxEmail: mailbox.email,
      sender: sender.value,
      count: messages.length,
      truncated: allMessages.length > maxResults,
      scannedFolders: folderResults.map(({ messages: _messages, ...folder }) => folder),
      messages,
    };
  }

  async previewBulkDeleteBySender(criteria: MailSenderSearchCriteria): Promise<MailBulkDeletePreview> {
    const mailbox = await this.resolveMailbox(criteria.mailboxUuid);
    const trashFolder = await this.resolveTrashFolder(mailbox.uuid);
    const result = await this.findMessagesBySender({ ...criteria, mailboxUuid: mailbox.uuid });
    const movableMessages = result.messages.filter((message) => message.folderId !== trashFolder.id);
    const skippedAlreadyInTargetCount = result.messages.length - movableMessages.length;
    const selectionToken = bulkSelectionToken({
      action: "move_to_trash",
      mailboxUuid: mailbox.uuid,
      sender: result.sender,
      targetFolderId: trashFolder.id,
      messages: movableMessages,
    });
    const confirmationPhrase = `MOVE ${movableMessages.length} MESSAGES FROM ${result.sender} TO TRASH`;

    return {
      ...result,
      count: movableMessages.length,
      messages: movableMessages,
      action: "move_to_trash",
      targetFolderId: trashFolder.id,
      targetFolderPath: trashFolder.path,
      skippedAlreadyInTargetCount,
      selectionToken,
      confirmationPhrase,
    };
  }

  async confirmBulkDeleteBySender(params: MailBulkDeleteConfirmParams): Promise<MailBulkDeleteResult> {
    const preview = await this.previewBulkDeleteBySender(params);
    if (preview.count === 0) {
      throw new Error("No matching messages are eligible to move to Trash.");
    }
    if (!safeStringEquals(params.selectionToken, preview.selectionToken)) {
      throw new Error("Bulk delete selection token no longer matches. Run mail_bulk_delete_preview again.");
    }
    if (params.confirmation !== preview.confirmationPhrase) {
      throw new Error(`Bulk delete confirmation must exactly equal: ${preview.confirmationPhrase}`);
    }

    const uids = preview.messages.map((message) => String(message.uid));
    await this.postMessageAction(preview.mailboxUuid, "move", { uids, to: preview.targetFolderId });
    this.invalidateMailboxCaches(preview.mailboxUuid);

    return {
      mailboxUuid: preview.mailboxUuid,
      sender: preview.sender,
      movedCount: uids.length,
      skippedAlreadyInTargetCount: preview.skippedAlreadyInTargetCount,
      targetFolderId: preview.targetFolderId,
      targetFolderPath: preview.targetFolderPath,
      uids,
      selectionToken: preview.selectionToken,
    };
  }

  async markMessagesAsSpam(params: MailMarkSpamParams): Promise<MailMarkSpamResult> {
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const uids = uniqueValues(params.uids.map((uid) => toApiMessageId(uid)));
    if (uids.length === 0) {
      throw new Error("At least one message UID is required.");
    }
    const expected = `MARK ${uids.length} MESSAGES AS SPAM`;
    if (params.confirmation !== expected) {
      throw new Error(`Spam confirmation must exactly equal: ${expected}`);
    }

    await this.postMessageAction(mailbox.uuid, "spam", { uids });
    this.invalidateMailboxCaches(mailbox.uuid);

    return {
      mailboxUuid: mailbox.uuid,
      markedCount: uids.length,
      uids,
    };
  }

  async getSpamSettings(mailboxUuid?: string): Promise<MailSpamSettings> {
    const mailbox = await this.resolveMailbox(mailboxUuid);
    const response = await this.apiRequest<RawSpamSettings>(
      `${securedMailboxPath(requireMailboxHosting(mailbox))}?with=authorized_senders,blocked_senders,has_move_spam`
    );
    return mapSpamSettings(mailbox, response.data ?? {});
  }

  async setSpamFilter(params: MailSetSpamFilterParams): Promise<MailSpamSettings> {
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const current = await this.getSpamSettings(mailbox.uuid);
    const expected = params.enabled ? "ENABLE SPAM FILTER" : "DISABLE SPAM FILTER";
    if (params.confirmation !== expected) {
      throw new Error(`Spam filter confirmation must exactly equal: ${expected}`);
    }

    await this.apiRequest<boolean>(securedMailboxPath(requireMailboxHosting(mailbox)), {
      method: "PATCH",
      body: JSON.stringify({ has_move_spam: params.enabled }),
    });

    return {
      ...current,
      hasMoveSpam: params.enabled,
    };
  }

  async blockSender(params: MailSenderRestrictionParams): Promise<MailSpamSettings> {
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const sender = normalizeBlockedSenderPattern(params.sender);
    const expected = `BLOCK ${sender}`;
    if (params.confirmation !== expected) {
      throw new Error(`Block sender confirmation must exactly equal: ${expected}`);
    }

    const current = await this.getSpamSettings(mailbox.uuid);
    const authorizedSenders = current.authorizedSenders.filter((candidate) => candidate.toLowerCase() !== sender);
    const blockedSenders = uniqueLowercaseStrings([...current.blockedSenders, sender]);

    await this.apiRequest<boolean>(securedMailboxPath(requireMailboxHosting(mailbox)), {
      method: "PATCH",
      body: JSON.stringify({
        authorized_senders: authorizedSenders,
        blocked_senders: blockedSenders,
      }),
    });

    return {
      ...current,
      authorizedSenders,
      blockedSenders,
    };
  }

  async unblockSender(params: MailSenderRestrictionParams): Promise<MailSpamSettings> {
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const sender = normalizeBlockedSenderPattern(params.sender);
    const current = await this.getSpamSettings(mailbox.uuid);
    const blockedSenders = current.blockedSenders.filter((candidate) => candidate.toLowerCase() !== sender);

    await this.apiRequest<boolean>(securedMailboxPath(requireMailboxHosting(mailbox)), {
      method: "PATCH",
      body: JSON.stringify({
        authorized_senders: current.authorizedSenders,
        blocked_senders: blockedSenders,
      }),
    });

    return {
      ...current,
      blockedSenders,
    };
  }

  async listMailboxFilters(mailboxUuid?: string): Promise<MailboxFiltersResult> {
    const mailbox = await this.resolveMailbox(mailboxUuid);
    const response = await this.apiRequest<RawMailboxFilters>(
      `${securedMailboxPath(requireMailboxHosting(mailbox))}/auth/filters`
    );
    return mapMailboxFilters(mailbox, response.data ?? {});
  }

  async sendMessage(params: SendMessageParams): Promise<MailSendResult> {
    const { mailbox, draftPayload, draftUuid, draftUid } = await this.createDraft(params);
    const preparedPayload = await this.prepareDraftPayload(mailbox, draftPayload, draftUuid, draftUid, params.attachments);

    const sendPayload = {
      ...preparedPayload,
      uuid: draftUuid,
      uid: preparedPayload.uid ?? draftUid ?? null,
      resource: `/api/mail/${mailbox.uuid}/draft/${draftUuid}`,
      action: "send",
    };

    const sendResponse = await this.apiRequest<{ msg_id?: string; message_id?: string; uuid?: string }>(
      `/mail/${encodeURIComponent(mailbox.uuid)}/draft/${encodeURIComponent(draftUuid)}`,
      {
        method: "PUT",
        body: JSON.stringify(sendPayload),
      }
    );
    if (sendResponse.result && sendResponse.result !== "success") {
      throw new Error(`Failed to send email: ${JSON.stringify(sendResponse)}`);
    }

    return {
      messageId: sendResponse.data?.msg_id ?? sendResponse.data?.message_id ?? sendResponse.data?.uuid ?? draftUuid,
    };
  }

  async saveDraft(params: MailSaveDraftParams): Promise<MailDraftResult> {
    const { mailbox, draftPayload, draftUuid, draftUid } = await this.createDraft(params);
    await this.prepareDraftPayload(mailbox, draftPayload, draftUuid, draftUid, params.attachments);
    return {
      mailboxUuid: mailbox.uuid,
      draftId: draftUuid,
      uid: draftUid,
      resource: `/api/mail/${mailbox.uuid}/draft/${draftUuid}`,
    };
  }

  async createFolder(params: MailCreateFolderParams): Promise<MailFolder> {
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const body: Record<string, unknown> = { name: params.name };
    if (params.parentFolder) {
      body.parent = await this.resolveFolderId(mailbox.uuid, params.parentFolder);
    }
    const response = await this.apiRequest<RawFolder>(`/mail/${encodeURIComponent(mailbox.uuid)}/folder`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    this.invalidateMailboxCaches(mailbox.uuid);
    return mapRawFolder(response.data ?? { name: params.name });
  }

  async renameFolder(params: MailRenameFolderParams): Promise<MailFolder> {
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const folderId = await this.resolveFolderId(mailbox.uuid, params.folder);
    const response = await this.apiRequest<RawFolder>(`/mail/${encodeURIComponent(mailbox.uuid)}/folder/${encodeURIComponent(folderId)}/rename`, {
      method: "POST",
      body: JSON.stringify({ name: params.newName }),
    });
    this.invalidateMailboxCaches(mailbox.uuid);
    return mapRawFolder(response.data ?? { id: folderId, name: params.newName });
  }

  async deleteFolder(params: MailDeleteFolderParams): Promise<void> {
    const expected = `DELETE MAIL FOLDER ${params.folder}`;
    if (params.confirmation !== expected) {
      throw new Error(`Folder delete confirmation must exactly equal: ${expected}`);
    }
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const folderId = await this.resolveFolderId(mailbox.uuid, params.folder);
    await this.apiRequest<unknown>(`/mail/${encodeURIComponent(mailbox.uuid)}/folder/${encodeURIComponent(folderId)}`, {
      method: "DELETE",
    });
    this.invalidateMailboxCaches(mailbox.uuid);
  }

  async moveMessage(folder: string, uid: MailUid, destinationFolder: string, mailboxUuid?: string): Promise<void> {
    const mailbox = await this.resolveMailbox(mailboxUuid);
    const destinationFolderId = await this.resolveFolderId(mailbox.uuid, destinationFolder);
    await this.postMessageAction(mailbox.uuid, "move", {
      uids: [toApiMessageId(uid)],
      to: destinationFolderId,
    });
    this.invalidateMailboxCaches(mailbox.uuid);
  }

  async deleteMessage(_folder: string, uid: MailUid, mailboxUuid?: string): Promise<void> {
    const mailbox = await this.resolveMailbox(mailboxUuid);
    const trashFolder = await this.resolveTrashFolder(mailbox.uuid);
    await this.postMessageAction(mailbox.uuid, "move", {
      uids: [toApiMessageId(uid)],
      to: trashFolder.id,
    });
    this.invalidateMailboxCaches(mailbox.uuid);
  }

  async flagMessage(
    _folder: string,
    uid: MailUid,
    flags: string[],
    action: "add" | "remove",
    mailboxUuid?: string
  ): Promise<void> {
    const mailbox = await this.resolveMailbox(mailboxUuid);
    const uids = [toApiMessageId(uid)];
    const messageActions = flags.map((flag) => {
      const apiAction = apiFlagAction(flag, action);
      if (!apiAction) {
        throw new Error(`Mail API flag action does not support "${flag}". Supported flags: \\Seen and \\Flagged.`);
      }
      return apiAction;
    });

    for (const messageAction of messageActions) {
      await this.postMessageAction(mailbox.uuid, messageAction, { uids });
    }
    this.invalidateMailboxCaches(mailbox.uuid);
  }

  private invalidateMailboxCaches(mailboxUuid: string): void {
    this.folderCache.delete(mailboxUuid);
    this.folderListPromises.delete(mailboxUuid);
  }

  private async fetchMailboxes(): Promise<MailboxSummary[]> {
    const response = await this.apiRequest<RawMailbox[]>("/mailbox?with=aliases,permissions,accountId,count_users");
    const mailboxes = (response.data ?? []).map(mapMailbox);
    if (mailboxes.length > 0 && !this.defaultMailbox) {
      this.defaultMailbox = mailboxes.find((mailbox) => mailbox.isPrimary) ?? mailboxes[0];
    }
    this.mailboxCache = { mailboxes, expiresAt: Date.now() + this.mailboxCacheMs };
    return mailboxes;
  }

  private async fetchFolders(mailboxUuid: string): Promise<MailFolder[]> {
    const response = await this.apiRequest<RawFolder[]>(`/mail/${encodeURIComponent(mailboxUuid)}/folder?with=ik-static`);
    const folders = flattenFolders(response.data ?? []);
    this.folderCache.set(mailboxUuid, { folders, expiresAt: Date.now() + this.folderCacheMs });
    return folders;
  }

  private async listMessagesAtOffset(
    mailboxUuid: string,
    folderId: string,
    limit: number,
    offset: number
  ): Promise<MailListMessagesResult> {
    const response = await this.apiRequest<{ count?: number; total?: number; threads?: RawThread[] }>(
      `/mail/${encodeURIComponent(mailboxUuid)}/folder/${encodeURIComponent(folderId)}/message?offset=${offset}&thread=on&severywhere=0&limit=${limit}`
    );
    const threads = response.data?.threads ?? [];
    const messages = threads.map(mapThread);
    return {
      messages,
      total: response.data?.count ?? response.data?.total ?? messages.length,
    };
  }

  private async resolveMailboxUuid(mailboxUuid?: string): Promise<string> {
    return (await this.resolveMailbox(mailboxUuid)).uuid;
  }

  private async resolveMailbox(mailboxUuid?: string): Promise<MailboxSummary> {
    if (mailboxUuid) {
      if (this.defaultMailbox?.uuid === mailboxUuid) return this.defaultMailbox;
      const mailboxes = await this.listMailboxes();
      const mailbox = mailboxes.find((candidate) => candidate.uuid === mailboxUuid);
      if (!mailbox) {
        throw new Error(`No Infomaniak mailbox found with UUID ${mailboxUuid}.`);
      }
      return mailbox;
    }

    if (this.defaultMailbox) return this.defaultMailbox;
    const mailboxes = await this.listMailboxes();
    if (mailboxes.length === 0) {
      throw new Error("No Infomaniak mailboxes found. Check that the token has the workspace:mail scope.");
    }
    this.defaultMailbox = mailboxes.find((mailbox) => mailbox.isPrimary) ?? mailboxes[0];
    return this.defaultMailbox;
  }

  private async resolveFolderId(mailboxUuid: string, folder: string): Promise<string> {
    const explicitFolderId = parseExplicitFolderId(folder);
    if (explicitFolderId) {
      return explicitFolderId;
    }

    const folders = await this.listFolders(mailboxUuid);
    const normalized = folder.toLowerCase();
    const match = folders.find((candidate) =>
      String(candidate.id).toLowerCase() === normalized ||
      candidate.path.toLowerCase() === normalized ||
      candidate.name.toLowerCase() === normalized ||
      candidate.role?.toLowerCase() === normalized ||
      candidate.specialUse?.toLowerCase() === normalized
    );
    return match?.id ?? folder;
  }

  private async resolveFolderRef(mailboxUuid: string, folder: string): Promise<{ id: string; path: string }> {
    const explicitFolderId = parseExplicitFolderId(folder);
    if (explicitFolderId) {
      return { id: explicitFolderId, path: `folder_id:${explicitFolderId}` };
    }

    const folders = await this.listFolders(mailboxUuid);
    const match = findFolderOrThrow(folders, folder);
    if (!match.id) {
      throw new Error(`Mail API folder "${match.path}" does not expose an ID.`);
    }
    return { id: match.id, path: match.path };
  }

  private async resolveSearchFolders(
    mailboxUuid: string,
    criteria: MailSenderSearchCriteria
  ): Promise<Array<MailFolder & { id: string }>> {
    const folders = await this.listFolders(mailboxUuid);
    const selected = criteria.allFolders
      ? folders
      : (criteria.folders?.length ? criteria.folders.map((folder) => findFolderOrThrow(folders, folder)) : [findFolderOrThrow(folders, "INBOX")]);

    return selected.map((folder) => {
      if (!folder.id) {
        throw new Error(`Mail API folder "${folder.path}" does not expose an ID.`);
      }
      return { ...folder, id: folder.id };
    });
  }

  private async resolveTrashFolder(mailboxUuid: string): Promise<MailFolder & { id: string }> {
    const folders = await this.listFolders(mailboxUuid);
    const trash = folders.find((folder) => isTrashFolder(folder));
    if (!trash?.id) {
      throw new Error("Could not find the Trash folder for this mailbox.");
    }
    return { ...trash, id: trash.id };
  }

  private async findMessagesBySenderInFolder(
    mailboxUuid: string,
    folder: MailFolder & { id: string },
    sender: NormalizedSenderCriteria,
    limitPerFolder: number,
    remainingResults: number
  ): Promise<MailSenderMessage[]> {
    const matches: MailSenderMessage[] = [];
    const pageSize = Math.min(limitPerFolder, 100);
    let page = 1;
    let scanned = 0;
    let total = Number.POSITIVE_INFINITY;

    while (matches.length < remainingResults && scanned < limitPerFolder && scanned < total) {
      const batch = await this.listMessages(`folder_id:${folder.id}`, pageSize, page, mailboxUuid);
      scanned += batch.messages.length;
      total = batch.total;

      for (const message of batch.messages) {
        if (matchesSender(message.from, sender)) {
          matches.push({
            mailboxUuid,
            folderId: folder.id,
            folderName: folder.name,
            folderPath: folder.path,
            uid: message.uid,
            subject: message.subject,
            from: message.from,
            date: message.date,
            flags: message.flags,
            preview: message.preview,
          });
          if (matches.length >= remainingResults) break;
        }
      }

      if (batch.messages.length === 0) break;
      page += 1;
    }

    return matches;
  }

  private async postMessageAction(
    mailboxUuid: string,
    action: "move" | "spam" | "seen" | "unseen" | "star" | "unstar",
    payload: { uids: string[]; to?: string }
  ): Promise<void> {
    for (const uids of chunk(payload.uids, MAIL_API_BATCH_LIMIT)) {
      await this.apiRequest<unknown>(`/mail/${encodeURIComponent(mailboxUuid)}/message/${action}`, {
        method: "POST",
        body: JSON.stringify(payload.to ? { uids, to: payload.to } : { uids }),
      });
    }
  }

  private async createDraft(params: MailSaveDraftParams): Promise<{
    mailbox: MailboxSummary;
    draftPayload: ReturnType<typeof buildDraftPayload>;
    draftUuid: string;
    draftUid?: MailUid;
  }> {
    const mailbox = await this.resolveMailbox(params.mailboxUuid);
    const draftPayload = buildDraftPayload(mailbox, params);
    const draftResponse = await this.apiRequest<{ uuid?: string; uid?: MailUid }>(
      `/mail/${encodeURIComponent(mailbox.uuid)}/draft`,
      {
        method: "POST",
        body: JSON.stringify(draftPayload),
      }
    );
    if (draftResponse.result && draftResponse.result !== "success") {
      throw new Error(`Failed to create draft: ${JSON.stringify(draftResponse)}`);
    }

    const draftUuid = draftResponse.data?.uuid;
    if (!draftUuid) {
      throw new Error(`Failed to create draft: missing draft UUID in ${JSON.stringify(draftResponse)}`);
    }

    return {
      mailbox,
      draftPayload,
      draftUuid,
      draftUid: draftResponse.data?.uid,
    };
  }

  private async prepareDraftPayload(
    mailbox: MailboxSummary,
    draftPayload: Record<string, unknown>,
    draftUuid: string,
    draftUid: MailUid | undefined,
    attachments?: SendMessageParams["attachments"]
  ): Promise<Record<string, unknown> & { uuid: string; uid?: MailUid; attachments: string[] }> {
    const attachmentUuids = attachments?.length
      ? await Promise.all(attachments.map((attachment) => this.uploadDraftAttachment(mailbox.uuid, attachment)))
      : [];
    const payload = {
      ...draftPayload,
      uuid: draftUuid,
      uid: draftUid ?? null,
      resource: `/api/mail/${mailbox.uuid}/draft/${draftUuid}`,
      action: "save",
      attachments: attachmentUuids,
    } as Record<string, unknown> & { uuid: string; uid?: MailUid; attachments: string[] };

    if (attachmentUuids.length > 0) {
      const response = await this.apiRequest<{ uid?: MailUid }>(
        `/mail/${encodeURIComponent(mailbox.uuid)}/draft/${encodeURIComponent(draftUuid)}`,
        { method: "PUT", body: JSON.stringify(payload) }
      );
      if (response.data?.uid !== undefined) payload.uid = response.data.uid;
    }
    return payload;
  }

  private async uploadDraftAttachment(mailboxUuid: string, attachment: NonNullable<SendMessageParams["attachments"]>[number]): Promise<string> {
    if (/[\r\n]/.test(attachment.filename) || (attachment.contentType && /[\r\n]/.test(attachment.contentType))) {
      throw new Error("Mail attachment filename and content type must not contain line breaks.");
    }
    const bytes = Buffer.from(attachment.base64Content, "base64");
    if (bytes.length > MAX_MAIL_API_ATTACHMENT_BYTES) {
      throw new Error(`Mail API attachment is too large (${bytes.length} bytes, max ${MAX_MAIL_API_ATTACHMENT_BYTES} bytes).`);
    }
    const response = await this.apiRequest<{ uuid?: string }>(
      `/mail/${encodeURIComponent(mailboxUuid)}/draft/attachment`,
      {
        method: "POST",
        headers: {
          "Content-Type": attachment.contentType ?? "application/octet-stream",
          "x-ws-attachment-disposition": attachment.contentDisposition ?? "attachment",
          "x-ws-attachment-filename": attachment.filename,
          "x-ws-attachment-mime-type": attachment.contentType ?? "application/octet-stream",
        },
        body: new Uint8Array(bytes),
      }
    );
    const uuid = response.data?.uuid;
    if (!uuid) {
      throw new Error(`Mail API attachment upload did not return an attachment UUID: ${JSON.stringify(response)}`);
    }
    return uuid;
  }

  private async downloadRaw(path: string): Promise<{ bytes: Uint8Array; headers: { get(name: string): string | null } }> {
    const response = await this.http.fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "*/*",
      },
    });
    if (!response.ok) {
      throw new Error(`Infomaniak Mail API attachment request failed: ${response.status} ${response.statusText}\n${await response.text()}`);
    }
    const contentLength = Number(response.headers?.get("content-length") ?? "0");
    if (contentLength > MAX_MAIL_API_ATTACHMENT_BYTES) {
      throw new Error(`Mail API attachment is too large (${contentLength} bytes, max ${MAX_MAIL_API_ATTACHMENT_BYTES} bytes).`);
    }
    if (!response.arrayBuffer) {
      throw new Error("Mail API attachment response did not expose binary content.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MAIL_API_ATTACHMENT_BYTES) {
      throw new Error(`Mail API attachment is too large (${bytes.byteLength} bytes, max ${MAX_MAIL_API_ATTACHMENT_BYTES} bytes).`);
    }
    return { bytes, headers: response.headers ?? { get: () => null } };
  }

  private async apiRequest<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const response = await this.http.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...((options.headers as Record<string, string> | undefined) ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Infomaniak Mail API request failed: ${response.status} ${response.statusText}\n${await response.text()}`);
    }

    const payload = await response.json() as ApiResponse<T>;
    if (payload.result && payload.result !== "success") {
      throw new Error(`Infomaniak Mail API returned ${payload.result}: ${JSON.stringify(payload)}`);
    }
    return payload;
  }
}

function parseExplicitFolderId(folder: string): string | undefined {
  const normalized = folder.trim();
  for (const prefix of ["folder_id:", "id:"]) {
    if (normalized.toLowerCase().startsWith(prefix)) {
      const value = normalized.slice(prefix.length).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

interface NormalizedSenderCriteria {
  kind: "email" | "domain";
  value: string;
}

function mapMailbox(mailbox: RawMailbox): MailboxSummary {
  return {
    uuid: mailbox.uuid,
    email: mailbox.email ?? "",
    mailbox: mailbox.mailbox ?? "",
    isPrimary: mailbox.is_primary,
    hostingId: mailbox.hosting_id,
  };
}

function mapRawFolder(folder: RawFolder): MailFolder {
  const mapped: MailFolder = {
    id: folder.id === undefined ? undefined : String(folder.id),
    name: folder.name ?? "",
    path: folder.name ?? "",
  };
  if (folder.role) {
    mapped.role = folder.role;
    mapped.specialUse = folder.role;
  }
  if (folder.unread_count !== undefined) mapped.unreadCount = folder.unread_count;
  if (folder.total_count !== undefined) mapped.totalCount = folder.total_count;
  return mapped;
}

function buildDraftPayload(mailbox: MailboxSummary, params: SendMessageParams): Record<string, unknown> {
  const htmlBody = params.html ?? toBasicHtml(params.text ?? "");
  return {
    uuid: null,
    subject: params.subject,
    body: htmlBody,
    quote: null,
    mime_type: "text/html",
    from: {
      id: null,
      name: mailbox.email.split("@")[0],
      email: mailbox.email,
    },
    reply_to: {
      name: mailbox.email.split("@")[0],
      email: mailbox.email,
    },
    to: params.to.map(toRecipient),
    cc: params.cc?.map(toRecipient) ?? null,
    bcc: params.bcc?.map(toRecipient) ?? null,
    references: params.references?.join(" ") ?? "",
    in_reply_to: params.inReplyTo ?? null,
    in_reply_to_uid: null,
    forwarded_uid: null,
    attachments: [],
    identity_id: null,
    ack_request: false,
    st_uuid: null,
    uid: null,
    resource: null,
    priority: "normal",
    encrypted: false,
    encryption_password: "",
    event_poll_uuid: null,
    action: "save",
    delay: 0,
  };
}

function findFolderOrThrow(folders: MailFolder[], folder: string): MailFolder {
  const normalized = (parseExplicitFolderId(folder) ?? folder).trim().toLowerCase();
  const match = folders.find((candidate) =>
    String(candidate.id).toLowerCase() === normalized ||
    candidate.path.toLowerCase() === normalized ||
    candidate.name.toLowerCase() === normalized ||
    candidate.role?.toLowerCase() === normalized ||
    candidate.specialUse?.toLowerCase() === normalized
  );
  if (!match) {
    throw new Error(`Could not find mail folder "${folder}". Use mail_list_folders to inspect available folders.`);
  }
  return match;
}

function isTrashFolder(folder: MailFolder): boolean {
  const candidates = [folder.id, folder.path, folder.name, folder.role, folder.specialUse]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  return candidates.some((value) => value === "trash" || value === "\\trash" || value.includes("trash"));
}

function normalizeSenderCriteria(sender: string): NormalizedSenderCriteria {
  const normalized = sender.trim().toLowerCase();
  if (normalized.startsWith("@") && normalized.length > 1 && !normalized.slice(1).includes("@")) {
    return { kind: "domain", value: normalized };
  }
  return { kind: "email", value: normalizeEmailAddress(normalized) };
}

function normalizeEmailAddress(sender: string): string {
  const normalized = sender.trim().toLowerCase();
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(normalized)) {
    throw new Error("Sender must be a full email address, for example sender@example.com.");
  }
  return normalized;
}

function normalizeBlockedSenderPattern(sender: string): string {
  const normalized = sender.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Sender block entry must not be empty.");
  }
  if (normalized.startsWith("@") && normalized.length > 1 && !normalized.slice(1).includes("@")) {
    return `*${normalized}`;
  }
  if (!normalized.includes("*") && !normalized.includes("?")) {
    return normalizeEmailAddress(normalized);
  }
  if (!/^[^\s<>]+@[^\s<>]+$/.test(normalized)) {
    throw new Error("Sender block entry must be an email address, @domain shorthand, or Infomaniak wildcard pattern such as *@example.com.");
  }
  return normalized;
}

function matchesSender(from: string, sender: NormalizedSenderCriteria): boolean {
  const emails = extractEmails(from);
  if (sender.kind === "domain") {
    return emails.some((email) => email.endsWith(sender.value));
  }
  return emails.some((email) => email === sender.value);
}

function extractEmails(value: string): string[] {
  return [...value.toLowerCase().matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z0-9-]+/g)]
    .map((match) => match[0]);
}

function flattenFolders(folders: RawFolder[], prefix = ""): MailFolder[] {
  const flattened: MailFolder[] = [];
  for (const folder of folders) {
    const name = folder.name ?? "";
    const separator = folder.separator ?? "/";
    const path = prefix ? `${prefix}${separator}${name}` : name;
    flattened.push({
      id: folder.id === undefined ? undefined : String(folder.id),
      name,
      path,
      role: folder.role,
      specialUse: folder.role,
      unreadCount: folder.unread_count,
      totalCount: folder.total_count,
    });
    if (folder.children?.length) {
      flattened.push(...flattenFolders(folder.children, path));
    }
  }
  return flattened;
}

function mapThread(thread: RawThread): MailMessageSummary {
  const firstMessage = thread.messages?.[0];
  const message: MailMessageSummary = {
    uid: toApiMessageId(firstMessage?.uid ?? thread.uid ?? ""),
    subject: thread.subject ?? "(no subject)",
    from: formatAddresses(thread.from),
    date: thread.date ?? "",
    flags: firstMessage?.flags ?? [],
    preview: firstMessage?.preview ?? "",
    threadUid: thread.uid,
    messagesCount: thread.messages_count,
    unseenMessages: thread.unseen_messages,
  };
  const seen = firstMessage?.seen ?? thread.seen;
  const flagged = firstMessage?.flagged ?? thread.flagged;
  const hasAttachments = firstMessage?.has_attachments ?? thread.has_attachments;
  if (seen !== undefined) message.seen = seen;
  if (flagged !== undefined) message.flagged = flagged;
  if (hasAttachments !== undefined) message.hasAttachments = hasAttachments;
  return message;
}

interface MailQueryFilters {
  query?: string;
  sender?: NormalizedSenderCriteria;
  unread?: boolean;
  flagged?: boolean;
  hasAttachment?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

interface MailQueryCursor {
  version: number;
  mailboxUuid: string;
  folderId: string;
  folderPath: string;
  offset: number;
  limit: number;
  filters: MailQueryFilters;
  anchorDate?: string;
  seenMessageKeys?: string[];
}

function normalizeQueryFilters(params: MailQueryParams): MailQueryFilters {
  return {
    query: params.query?.trim().toLowerCase() || undefined,
    sender: params.sender ? normalizeSenderCriteria(params.sender) : undefined,
    unread: params.unread,
    flagged: params.flagged,
    hasAttachment: params.hasAttachment,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  };
}

function matchesQueryFilters(message: MailMessageSummary, filters: MailQueryFilters): boolean {
  if (filters.query && !messageMatchesQuery(message, filters.query)) {
    return false;
  }
  if (filters.sender && !matchesSender(message.from, filters.sender)) {
    return false;
  }
  if (filters.unread !== undefined) {
    const isUnread = message.seen === false || (message.unseenMessages ?? 0) > 0 || (message.flags.length > 0 && !message.flags.includes("\\Seen"));
    if (isUnread !== filters.unread) return false;
  }
  if (filters.flagged !== undefined) {
    const isFlagged = message.flagged === true || message.flags.includes("\\Flagged");
    if (isFlagged !== filters.flagged) return false;
  }
  if (filters.hasAttachment !== undefined && Boolean(message.hasAttachments) !== filters.hasAttachment) {
    return false;
  }
  if (filters.dateFrom && Date.parse(message.date) < Date.parse(filters.dateFrom)) {
    return false;
  }
  if (filters.dateTo && Date.parse(message.date) > Date.parse(filters.dateTo)) {
    return false;
  }
  return true;
}

function messageMatchesQuery(message: MailMessageSummary, normalizedQuery: string): boolean {
  return [
    String(message.uid),
    message.subject,
    message.from,
    message.preview ?? "",
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function mailMessageKey(message: MailMessageSummary): string {
  return `${message.folderId ?? ""}:${String(message.uid)}`;
}

function isAfterAnchor(messageDate: string, anchorDate: string): boolean {
  const messageTime = Date.parse(messageDate);
  const anchorTime = Date.parse(anchorDate);
  return Number.isFinite(messageTime) && Number.isFinite(anchorTime) && messageTime > anchorTime;
}

function encodeMailQueryCursor(cursor: MailQueryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeMailQueryCursor(cursor: string): MailQueryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<MailQueryCursor>;
    if (
      parsed.version !== MAIL_QUERY_CURSOR_VERSION ||
      typeof parsed.mailboxUuid !== "string" ||
      typeof parsed.folderId !== "string" ||
      typeof parsed.folderPath !== "string" ||
      typeof parsed.offset !== "number" ||
      typeof parsed.limit !== "number" ||
      typeof parsed.filters !== "object" ||
      parsed.filters === null ||
      (parsed.anchorDate !== undefined && typeof parsed.anchorDate !== "string") ||
      (parsed.seenMessageKeys !== undefined && !Array.isArray(parsed.seenMessageKeys))
    ) {
      throw new Error("invalid cursor shape");
    }
    if (parsed.seenMessageKeys?.some((key) => typeof key !== "string")) {
      throw new Error("invalid cursor message keys");
    }
    return parsed as MailQueryCursor;
  } catch (error) {
    throw new Error("Invalid mail query cursor. Run mail_query again without a cursor.");
  }
}

function formatAddressList(addresses: RawAddress[] | undefined): string[] {
  return (addresses ?? []).map(formatAddress);
}

function formatAddresses(addresses: RawAddress[] | undefined): string {
  return formatAddressList(addresses).join(", ");
}

function formatAddress(address: RawAddress): string {
  if (address.name && address.email) return `${address.name} <${address.email}>`;
  return address.email ?? address.name ?? "";
}

function summarizeApiAttachments(message: RawMessage): MailAttachment[] {
  return (message.attachments ?? []).map((attachment) => ({
    id: attachment.id ?? attachment.resource?.split("/").pop() ?? (attachment.part_id === undefined ? undefined : String(attachment.part_id)),
    filename: attachment.filename ?? attachment.name ?? "unnamed",
    contentType: attachment.contentType ?? attachment.content_type ?? attachment.mime_type ?? "application/octet-stream",
    size: attachment.size ?? 0,
    resource: attachment.resource,
  }));
}

function parseContentDispositionFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1]?.trim();
}

function toRecipient(email: string): { name: string; email: string } {
  return { name: "", email: email.trim() };
}

function toApiMessageId(uid: MailUid): string {
  return String(uid).split("@", 1)[0];
}

function requireMailboxHosting(mailbox: MailboxSummary): MailboxSummary & { hostingId: number; mailbox: string } {
  if (!mailbox.hostingId || !mailbox.mailbox) {
    throw new Error("Mailbox hosting ID and mailbox name are required for spam/filter settings. Use mail_list_mailboxes to verify the Mail API response includes hostingId and mailbox.");
  }
  return mailbox as MailboxSummary & { hostingId: number; mailbox: string };
}

function securedMailboxPath(mailbox: MailboxSummary & { hostingId: number; mailbox: string }): string {
  return `/securedProxy/1/mail_hostings/${encodeURIComponent(String(mailbox.hostingId))}/mailboxes/${encodeURIComponent(mailbox.mailbox)}`;
}

function mapSpamSettings(mailbox: MailboxSummary, settings: RawSpamSettings): MailSpamSettings {
  const hostedMailbox = requireMailboxHosting(mailbox);
  return {
    mailboxUuid: mailbox.uuid,
    mailboxEmail: mailbox.email,
    mailboxName: hostedMailbox.mailbox,
    hostingId: hostedMailbox.hostingId,
    hasMoveSpam: settings.has_move_spam,
    authorizedSenders: normalizeSenderList(settings.authorized_senders),
    blockedSenders: normalizeSenderList(settings.blocked_senders),
  };
}

function normalizeSenderList(senders: Array<RawSenderRestriction | string> | undefined): string[] {
  return uniqueLowercaseStrings((senders ?? [])
    .map((sender) => typeof sender === "string" ? sender : sender.email)
    .filter((sender): sender is string => typeof sender === "string" && sender.trim().length > 0)
    .map((sender) => sender.trim().toLowerCase()));
}

function mapMailboxFilters(mailbox: MailboxSummary, filters: RawMailboxFilters): MailboxFiltersResult {
  return {
    mailboxUuid: mailbox.uuid,
    mailboxEmail: mailbox.email,
    preventScript: Boolean(filters.prevent_script),
    useScripts: Boolean(filters.use_scripts),
    scripts: (filters.scripts ?? []).map((script) => ({
      name: script.name ?? "",
      isEnabled: script.is_enabled ?? false,
      content: script.content ?? "",
    })),
    filters: (filters.filters ?? []).map((filter) => ({
      name: filter.name ?? "",
      isEnabled: Boolean(filter.is_enabled),
      hasAllOf: Boolean(filter.has_all_of),
      conditions: filter.conditions ?? [],
      actions: filter.actions ?? [],
      templateId: filter.template_id,
    })),
    templates: filters.templates ?? [],
  };
}

function bulkSelectionToken(input: {
  action: "move_to_trash";
  mailboxUuid: string;
  sender: string;
  targetFolderId: string;
  messages: MailSenderMessage[];
}): string {
  const messageKeys = input.messages
    .map((message) => `${message.folderId}:${String(message.uid)}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({
      action: input.action,
      mailboxUuid: input.mailboxUuid,
      sender: input.sender,
      targetFolderId: input.targetFolderId,
      messageKeys,
    }))
    .digest("hex");
}

function safeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function apiFlagAction(flag: string, action: "add" | "remove"): "seen" | "unseen" | "star" | "unstar" | undefined {
  const normalized = flag.trim().toLowerCase();
  if (normalized === "\\seen" || normalized === "seen") {
    return action === "add" ? "seen" : "unseen";
  }
  if (normalized === "\\flagged" || normalized === "flagged" || normalized === "starred") {
    return action === "add" ? "star" : "unstar";
  }
  return undefined;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(values[currentIndex], currentIndex);
    }
  }));

  return results;
}

function uniqueLowercaseStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function toBasicHtml(text: string): string {
  return `<html><body><div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px;">${escapeHtml(text).replace(/\n/g, "<br>")}</div></body></html>`;
}

function truncateBody(value: string, maxChars?: number): string {
  if (!maxChars || maxChars < 1 || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated to ${maxChars} characters]`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
