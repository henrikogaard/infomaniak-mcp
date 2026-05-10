import type {
  MailAttachment,
  MailboxSummary,
  MailFolder,
  MailListMessagesResult,
  MailMessageSummary,
  MailReadMessageResult,
  MailSendResult,
  MailToolService,
  MailUid,
  SendMessageParams,
} from "./mail.js";

interface ApiResponse<T> {
  result?: string;
  data?: T;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponse>;

interface MailApiServiceOptions {
  token: string;
  baseUrl?: string;
  fetch?: FetchLike;
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
}

interface RawThread {
  uid?: MailUid;
  subject?: string;
  from?: RawAddress[];
  date?: string;
  messages_count?: number;
  unseen_messages?: number;
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
  attachments?: Array<{ filename?: string; name?: string; content_type?: string; contentType?: string; size?: number }>;
  seen?: boolean;
  flagged?: boolean;
  folder?: unknown;
  headers?: unknown;
}

const DEFAULT_API_BASE = "https://mail.infomaniak.com/api";

export class MailApiService implements Partial<MailToolService> {
  readonly supportsMailboxes = true;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private defaultMailbox: MailboxSummary | null = null;

  constructor(options: MailApiServiceOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listMailboxes(): Promise<MailboxSummary[]> {
    const response = await this.apiRequest<RawMailbox[]>("/mailbox?with=aliases,permissions,accountId,count_users");
    const mailboxes = (response.data ?? []).map(mapMailbox);
    if (mailboxes.length > 0 && !this.defaultMailbox) {
      this.defaultMailbox = mailboxes.find((mailbox) => mailbox.isPrimary) ?? mailboxes[0];
    }
    return mailboxes;
  }

  async listFolders(mailboxUuid?: string): Promise<MailFolder[]> {
    const uuid = await this.resolveMailboxUuid(mailboxUuid);
    const response = await this.apiRequest<RawFolder[]>(`/mail/${encodeURIComponent(uuid)}/folder?with=ik-static`);
    return flattenFolders(response.data ?? []);
  }

  async listMessages(
    folder: string = "INBOX",
    limit: number = 20,
    page: number = 1,
    mailboxUuid?: string
  ): Promise<MailListMessagesResult> {
    const uuid = await this.resolveMailboxUuid(mailboxUuid);
    const folderId = await this.resolveFolderId(uuid, folder);
    const offset = Math.max(0, (Math.max(1, page) - 1) * limit);
    const response = await this.apiRequest<{ count?: number; total?: number; threads?: RawThread[] }>(
      `/mail/${encodeURIComponent(uuid)}/folder/${encodeURIComponent(folderId)}/message?offset=${offset}&thread=on&severywhere=0&limit=${limit}`
    );
    const threads = response.data?.threads ?? [];
    const messages = threads.map(mapThread);
    return {
      messages,
      total: response.data?.count ?? response.data?.total ?? messages.length,
    };
  }

  async readMessage(folder: string, uid: MailUid, mailboxUuid?: string): Promise<MailReadMessageResult> {
    const uuid = await this.resolveMailboxUuid(mailboxUuid);
    const folderId = await this.resolveFolderId(uuid, folder);
    const response = await this.apiRequest<RawMessage>(
      `/mail/${encodeURIComponent(uuid)}/folder/${encodeURIComponent(folderId)}/message/${encodeURIComponent(toApiMessageId(uid))}?prefered_format=html&with=auto_uncrypt,thread_context`
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
      text: message.body ?? "",
      html: message.html ?? "",
      attachments: summarizeApiAttachments(message),
      preview: message.preview,
      seen: message.seen,
      flagged: message.flagged,
      folder: message.folder,
      headers: message.headers,
    };
  }

  async sendMessage(params: SendMessageParams): Promise<MailSendResult> {
    if (params.attachments?.length) {
      throw new Error("Infomaniak Mail API attachment sending is not implemented yet; configure MAIL_USER and MAIL_PASSWORD to use SMTP fallback for attachments.");
    }

    const mailbox = await this.resolveMailbox();
    const htmlBody = params.html ?? toBasicHtml(params.text ?? "");
    const draftPayload = {
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

    const sendPayload = {
      ...draftPayload,
      uuid: draftUuid,
      uid: draftResponse.data?.uid ?? null,
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

  private async resolveMailboxUuid(mailboxUuid?: string): Promise<string> {
    if (mailboxUuid) return mailboxUuid;
    return (await this.resolveMailbox()).uuid;
  }

  private async resolveMailbox(): Promise<MailboxSummary> {
    if (this.defaultMailbox) return this.defaultMailbox;
    const mailboxes = await this.listMailboxes();
    if (mailboxes.length === 0) {
      throw new Error("No Infomaniak mailboxes found. Check that the token has the workspace:mail scope.");
    }
    this.defaultMailbox = mailboxes.find((mailbox) => mailbox.isPrimary) ?? mailboxes[0];
    return this.defaultMailbox;
  }

  private async resolveFolderId(mailboxUuid: string, folder: string): Promise<string> {
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

  private async apiRequest<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
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

function mapMailbox(mailbox: RawMailbox): MailboxSummary {
  return {
    uuid: mailbox.uuid,
    email: mailbox.email ?? "",
    mailbox: mailbox.mailbox ?? "",
    isPrimary: mailbox.is_primary,
    hostingId: mailbox.hosting_id,
  };
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
  return {
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
    filename: attachment.filename ?? attachment.name ?? "unnamed",
    contentType: attachment.contentType ?? attachment.content_type ?? "application/octet-stream",
    size: attachment.size ?? 0,
  }));
}

function toRecipient(email: string): { name: string; email: string } {
  return { name: "", email: email.trim() };
}

function toApiMessageId(uid: MailUid): string {
  return String(uid).split("@", 1)[0];
}

function toBasicHtml(text: string): string {
  return `<html><body><div style="font-family: Helvetica, Arial, sans-serif; font-size: 14px;">${escapeHtml(text).replace(/\n/g, "<br>")}</div></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
