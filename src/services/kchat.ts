interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponse>;

interface KChatServiceOptions {
  token: string;
  teamName: string;
  fetch?: FetchLike;
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

export class KChatService {
  private readonly token: string;
  private readonly teamName: string;
  private readonly fetchImpl: FetchLike;
  private cachedTeam: KChatTeam | null = null;

  constructor(options: KChatServiceOptions) {
    this.token = options.token;
    this.teamName = options.teamName;
    this.fetchImpl = options.fetch ?? fetch;
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

  async postMessage(channelId: string, text: string, threadId?: string): Promise<unknown> {
    const body: Record<string, string> = {
      channel_id: channelId,
      message: text,
    };
    if (threadId) {
      body.root_id = threadId;
    }
    return this.request("/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async replyToThread(threadId: string, text: string): Promise<unknown> {
    const post = await this.getPost(threadId);
    if (!post.channel_id) {
      throw new Error(`kChat post ${threadId} did not include a channel_id.`);
    }
    return this.postMessage(post.channel_id, text, threadId);
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
    return this.request<KChatUser>("/users/me");
  }

  async getUserByUsername(username: string): Promise<KChatUser> {
    return this.request<KChatUser>(`/users/username/${encodeURIComponent(username)}`);
  }

  async sendDirectMessage(username: string, text: string): Promise<unknown> {
    const currentUser = await this.getCurrentUser();
    const recipient = await this.getUserByUsername(username);
    const channel = await this.createDirectChannel([currentUser.id, recipient.id]);
    return this.postMessage(channel.id, text);
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

    const response = await this.fetchImpl(`${this.baseUrl()}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> | undefined),
      },
    });

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

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(value, max));
}
