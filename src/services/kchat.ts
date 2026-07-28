import { ThrottledHttpClient, type HttpFetch } from "./http-client.js";

interface KChatServiceOptions {
  token: string;
  teamName: string;
  fetch?: HttpFetch;
  maxConcurrent?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  timeoutMs?: number;
}

interface KChatTeam {
  id: string;
  [key: string]: unknown;
}

interface KChatPost {
  id: string;
  channel_id?: string;
  [key: string]: unknown;
}

interface KChatUser {
  id: string;
  username?: string;
  [key: string]: unknown;
}

interface ListOptions {
  limit?: number;
  page?: number;
}

export interface KChatSearchOptions {
  terms: string;
  isOrSearch?: boolean;
  timeZoneOffset?: number;
  includeDeletedChannels?: boolean;
  page?: number;
  perPage?: number;
}

export class KChatService {
  private readonly token: string;
  private readonly teamName: string;
  private readonly http: ThrottledHttpClient;
  private cachedTeam: KChatTeam | null = null;
  private cachedCurrentUser: KChatUser | null = null;
  private readonly userByUsernameCache = new Map<string, KChatUser>();
  private readonly directChannelCache = new Map<string, { id: string }>();

  constructor(options: KChatServiceOptions) {
    this.token = options.token;
    this.teamName = normalizeKChatTeamName(options.teamName);
    this.http = new ThrottledHttpClient({
      fetch: options.fetch,
      maxConcurrent: options.maxConcurrent,
      retries: options.retries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      timeoutMs: options.timeoutMs,
    });
  }

  async getTeamByName(): Promise<KChatTeam> {
    if (this.cachedTeam) return this.cachedTeam;
    const team = await this.request<KChatTeam>(`/teams/name/${encodeURIComponent(this.teamName)}`);
    this.cachedTeam = team;
    return team;
  }

  async listChannels(options: ListOptions = {}): Promise<unknown> {
    const team = await this.getTeamByName();
    const params = new URLSearchParams({
      per_page: clampLimit(options.limit, 100, 200).toString(),
      page: String(options.page ?? 0),
    });
    return this.request(`/teams/${encodeURIComponent(team.id)}/channels?${params}`);
  }

  async postMessage(channelId: string, text: string, threadId?: string, fileIds?: string[]): Promise<unknown> {
    const body: Record<string, unknown> = {
      channel_id: channelId,
      message: text,
    };
    if (threadId) {
      body.root_id = threadId;
    }
    if (fileIds?.length) {
      body.file_ids = fileIds;
    }
    return this.request("/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async replyToThread(threadId: string, text: string, fileIds?: string[]): Promise<unknown> {
    const post = await this.getPost(threadId);
    if (!post.channel_id) {
      throw new Error(`kChat post ${threadId} did not include a channel_id.`);
    }
    return this.postMessage(post.channel_id, text, threadId, fileIds);
  }

  async uploadFile(channelId: string, filename: string, base64Content: string, contentType = "application/octet-stream"): Promise<unknown> {
    const params = new URLSearchParams({ channel_id: channelId, filename });
    return this.request(`/files?${params}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(Buffer.from(base64Content, "base64")),
    });
  }

  async searchPosts(options: KChatSearchOptions): Promise<unknown> {
    const team = await this.getTeamByName();
    return this.request(`/teams/${encodeURIComponent(team.id)}/posts/search`, {
      method: "POST",
      body: JSON.stringify({
        terms: options.terms,
        is_or_search: options.isOrSearch ?? false,
        ...(options.timeZoneOffset === undefined ? {} : { time_zone_offset: options.timeZoneOffset }),
        ...(options.includeDeletedChannels === undefined ? {} : { include_deleted_channels: options.includeDeletedChannels }),
        ...(options.page === undefined ? {} : { page: options.page }),
        ...(options.perPage === undefined ? {} : { per_page: options.perPage }),
      }),
    });
  }

  async addReaction(postId: string, emojiName: string): Promise<unknown> {
    return this.request("/reactions", {
      method: "POST",
      body: JSON.stringify({
        post_id: postId,
        emoji_name: emojiName,
      }),
    });
  }

  async getChannelHistory(channelId: string, options: ListOptions = {}): Promise<unknown> {
    const params = new URLSearchParams({
      per_page: clampLimit(options.limit, 10, 100).toString(),
      page: String(options.page ?? 0),
    });
    return this.request(`/channels/${encodeURIComponent(channelId)}/posts?${params}`);
  }

  async getThreadReplies(threadId: string): Promise<unknown> {
    return this.request(`/posts/${encodeURIComponent(threadId)}/thread`);
  }

  async getUsers(options: ListOptions = {}): Promise<unknown> {
    const params = new URLSearchParams({
      per_page: clampLimit(options.limit, 100, 100).toString(),
      page: String(options.page ?? 0),
    });
    return this.request(`/users?${params}`);
  }

  async getUserProfile(userId: string): Promise<unknown> {
    return this.request(`/users/${encodeURIComponent(userId)}`);
  }

  async getPost(postId: string): Promise<KChatPost> {
    return this.request<KChatPost>(`/posts/${encodeURIComponent(postId)}`);
  }

  async getCurrentUser(): Promise<KChatUser> {
    if (this.cachedCurrentUser) return this.cachedCurrentUser;
    const user = await this.request<KChatUser>("/users/me");
    this.cachedCurrentUser = user;
    return user;
  }

  async getUserByUsername(username: string): Promise<KChatUser> {
    const normalized = username.trim().toLowerCase();
    const cached = this.userByUsernameCache.get(normalized);
    if (cached) return cached;

    const user = await this.request<KChatUser>(`/users/username/${encodeURIComponent(username)}`);
    this.userByUsernameCache.set(normalized, user);
    return user;
  }

  async sendDirectMessage(username: string, text: string): Promise<unknown> {
    const currentUser = await this.getCurrentUser();
    const recipient = await this.getUserByUsername(username);
    const channel = await this.getDirectChannel(currentUser.id, recipient.id);
    return this.postMessage(channel.id, text);
  }

  private async getDirectChannel(currentUserId: string, recipientUserId: string): Promise<{ id: string }> {
    const key = [currentUserId, recipientUserId].sort().join(":");
    const cached = this.directChannelCache.get(key);
    if (cached) return cached;

    const channel = await this.createDirectChannel([currentUserId, recipientUserId]);
    this.directChannelCache.set(key, channel);
    return channel;
  }

  private async createDirectChannel(userIds: string[]): Promise<{ id: string }> {
    return this.request<{ id: string }>("/channels/direct", {
      method: "POST",
      body: JSON.stringify(userIds),
    });
  }

  private async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "User-Agent": "infomaniak-mcp",
    };
    if (options.method === "POST" || options.method === "PUT" || options.method === "PATCH") {
      headers["Content-Type"] = "application/json";
    }

    const url = `${this.baseUrl()}${path}`;
    let response;
    try {
      response = await this.http.fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers as Record<string, string> | undefined),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `kChat API ${options.method ?? "GET"} ${path} network error for ${this.baseUrl()}: ${message}. ` +
        "Check KCHAT_TEAM_NAME (expected the team slug or kChat URL) and KCHAT_TOKEN."
      );
    }

    if (!response.ok) {
      throw new Error(`kChat API ${options.method ?? "GET"} ${path} -> ${response.status}: ${await response.text()}`);
    }

    const contentType = response.headers?.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json() as Promise<T>;
    }
    return (await response.text()) as T;
  }

  private baseUrl(): string {
    return `https://${this.teamName}.kchat.infomaniak.com/api/v4`;
  }
}

function normalizeKChatTeamName(teamName: string): string {
  const trimmed = teamName.trim();
  if (!trimmed) {
    throw new Error("KCHAT_TEAM_NAME is required.");
  }

  let candidate = trimmed;
  try {
    if (candidate.includes("://")) {
      candidate = teamFromKChatUrl(new URL(candidate)) ?? new URL(candidate).hostname;
    } else if (candidate.includes(".") || candidate.includes("/")) {
      const parsed = new URL(`https://${candidate}`);
      candidate = teamFromKChatUrl(parsed) ?? parsed.hostname;
    }
  } catch {
    candidate = trimmed.split("/", 1)[0];
  }

  const host = candidate.split("/", 1)[0].trim().toLowerCase();
  const suffix = ".kchat.infomaniak.com";
  const normalized = host.endsWith(suffix) ? host.slice(0, -suffix.length) : host;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw new Error("KCHAT_TEAM_NAME must be a kChat team slug or URL, for example your-team or https://your-team.kchat.infomaniak.com/.");
  }
  return normalized;
}

function teamFromKChatUrl(url: URL): string | undefined {
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".kchat.infomaniak.com") && host !== "kchat.infomaniak.com") {
    return host.slice(0, -".kchat.infomaniak.com".length);
  }
  if (host === "kchat.infomaniak.com") {
    const segment = url.pathname.split("/").find((part) => part.length > 0);
    return segment;
  }
  return undefined;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(value, max));
}
