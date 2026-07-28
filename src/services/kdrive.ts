import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse<T = unknown> {
  data?: T;
  cursor?: string;
  has_more?: boolean;
  response_at?: number;
}

interface FileEntry {
  id: number;
  name: string;
  type: string;
  size?: number;
  created_at?: string;
  updated_at?: string;
  path?: string;
  [key: string]: unknown;
}

export interface KDriveSearchOptions {
  directoryId?: number;
  depth?: "child" | "unlimited";
}

export interface KDriveCursorOptions {
  cursor?: string;
  limit?: number;
  type?: string;
}

export interface KDrivePage {
  items: FileEntry[];
  cursor?: string;
  hasMore?: boolean;
  responseAt?: number;
}

export class KDriveService {
  private api: InfomaniakAPI;
  private driveId: string;
  private token: string;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
    this.driveId = config.kdriveId;
    this.token = config.infomaniakToken;
  }

  async searchFiles(query: string, limit = 20, options: KDriveSearchOptions = {}): Promise<FileEntry[]> {
    const res = (await this.api.get(`/3/drive/${this.driveId}/files/search`, toQueryParams({
      query,
      limit,
      directory_id: options.directoryId,
      depth: options.depth,
    }))) as ApiResponse;
    return (res.data ?? []) as FileEntry[];
  }

  async listFiles(folderId: string | number = "root"): Promise<FileEntry[]> {
    const id = folderId === "root" ? 1 : folderId;
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/${id}/files`
    )) as ApiResponse;
    return (res.data ?? []) as FileEntry[];
  }

  async listFilesPage(folderId: string | number = "root", options: KDriveCursorOptions = {}): Promise<KDrivePage> {
    const id = folderId === "root" ? 1 : folderId;
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/${id}/files`,
      toQueryParams({
        cursor: options.cursor,
        limit: options.limit,
        "type[]": options.type,
      })
    )) as ApiResponse<FileEntry[]>;
    return {
      items: (res.data ?? []) as FileEntry[],
      cursor: res.cursor,
      hasMore: res.has_more,
      responseAt: res.response_at,
    };
  }

  async getFileMetadata(fileId: number): Promise<FileEntry> {
    const res = (await this.api.get(
      `/2/drive/${this.driveId}/files/${fileId}`
    )) as ApiResponse;
    return res.data as FileEntry;
  }

  async downloadFile(fileId: number): Promise<string> {
    const buf = await this.api.downloadRaw(
      `/2/drive/${this.driveId}/files/${fileId}/download`
    );
    return buf.toString("base64");
  }

  async uploadFile(folderId: number, filename: string, base64Content: string): Promise<FileEntry> {
    const fileBuffer = Buffer.from(base64Content, "base64");
    const timestamp = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      directory_id: String(folderId),
      file_name: filename.replaceAll("/", ":"),
      created_date: String(timestamp),
      last_modified_at: String(timestamp),
      total_size: String(fileBuffer.length),
      conflict: "rename",
    });

    const res = await fetch(`https://api.infomaniak.com/3/drive/${this.driveId}/upload?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/octet-stream",
      },
      body: fileBuffer,
    });

    if (!res.ok) {
      throw new Error(`Infomaniak upload ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as ApiResponse;
    return data.data as FileEntry;
  }

  async createFolder(parentId: number, name: string): Promise<FileEntry> {
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${parentId}/directory`,
      { name }
    )) as ApiResponse;
    return res.data as FileEntry;
  }

  async deleteFile(fileId: number): Promise<void> {
    await this.api.delete(`/2/drive/${this.driveId}/files/${fileId}`);
  }

  async moveFile(
    fileId: number,
    destinationFolderId: number
  ): Promise<FileEntry> {
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${fileId}/move/${destinationFolderId}`,
      {}
    )) as ApiResponse;
    return res.data as FileEntry;
  }

  async renameFile(fileId: number, name: string): Promise<FileEntry> {
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${fileId}/rename`,
      { name }
    )) as ApiResponse;
    return res.data as FileEntry;
  }

  async getShareLink(fileId: number): Promise<unknown> {
    const res = (await this.api.get(
      `/2/drive/${this.driveId}/files/${fileId}/link`
    )) as ApiResponse;
    return res.data;
  }

  async createShareLink(fileId: number, options: ShareLinkOptions = {}): Promise<unknown> {
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${fileId}/link`,
      toShareLinkBody(options)
    )) as ApiResponse;
    return res.data;
  }

  async updateShareLink(fileId: number, options: ShareLinkOptions): Promise<unknown> {
    const res = (await this.api.put(
      `/2/drive/${this.driveId}/files/${fileId}/link`,
      toShareLinkBody(options)
    )) as ApiResponse;
    return res.data;
  }

  async deleteShareLink(fileId: number): Promise<void> {
    await this.api.delete(`/2/drive/${this.driveId}/files/${fileId}/link`);
  }

  async shareAccess(
    fileId: number,
    emails: string[],
    right: string,
    message?: string,
    lang = "en"
  ): Promise<unknown> {
    const body: Record<string, unknown> = { emails, right };
    if (message) body.message = message;
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${fileId}/access/invitations?lang=${encodeURIComponent(lang)}`,
      body
    )) as ApiResponse;
    return res.data;
  }

  async listSharedWithMe(options: { type?: string } = {}): Promise<unknown> {
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/shared_with_me`,
      toQueryParams({ "type[]": options.type })
    )) as ApiResponse;
    return res.data;
  }

  async listShareLinks(options: ListShareLinksOptions = {}): Promise<unknown> {
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/links`,
      toQueryParams({
        cursor: options.cursor,
        limit: options.limit,
        order_by: options.orderBy,
        order: options.order,
        order_for: options.orderFor,
        right: options.right,
        type: options.type,
      })
    )) as ApiResponse;
    return res.data;
  }

  async listVersions(fileId: number, options: PageOptions = {}): Promise<unknown> {
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/${fileId}/versions`,
      toQueryParams({
        page: options.page,
        per_page: options.perPage,
        total: options.total,
        order_by: options.orderBy,
        order: options.order,
        order_for: options.orderFor,
      })
    )) as ApiResponse;
    return res.data;
  }

  async restoreVersion(fileId: number, versionId: number | string): Promise<unknown> {
    const res = (await this.api.post(
      `/3/drive/${this.driveId}/files/${fileId}/versions/${versionId}/restore`,
      {}
    )) as ApiResponse;
    return res.data;
  }

  async restoreVersionToDirectory(
    fileId: number,
    versionId: number | string,
    destinationDirectoryId: number,
    name?: string
  ): Promise<unknown> {
    const res = (await this.api.post(
      `/3/drive/${this.driveId}/files/${fileId}/versions/${versionId}/restore/${destinationDirectoryId}`,
      name ? { name } : {}
    )) as ApiResponse;
    return res.data;
  }

  async listTrash(options: ListTrashOptions = {}): Promise<unknown> {
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/trash`,
      toQueryParams({
        cursor: options.cursor,
        limit: options.limit,
        order_by: options.orderBy,
        order: options.order,
        order_for: options.orderFor,
        type: options.type,
      })
    )) as ApiResponse;
    return res.data;
  }

  async restoreFromTrash(fileId: number, destinationDirectoryId?: number): Promise<unknown> {
    const body = destinationDirectoryId === undefined
      ? {}
      : { destination_directory_id: destinationDirectoryId };
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/trash/${fileId}/restore`,
      body
    )) as ApiResponse;
    return res.data;
  }

  async listComments(fileId: number, options: PageOptions = {}): Promise<unknown> {
    const res = (await this.api.get(
      `/2/drive/${this.driveId}/files/${fileId}/comments`,
      toQueryParams({
        page: options.page,
        per_page: options.perPage,
        total: options.total,
        order_by: options.orderBy,
        order: options.order,
        order_for: options.orderFor,
      })
    )) as ApiResponse;
    return res.data;
  }

  async addComment(fileId: number, body: string): Promise<unknown> {
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${fileId}/comments`,
      { body }
    )) as ApiResponse;
    return res.data;
  }

  async replyToComment(fileId: number, commentId: number, body: string): Promise<unknown> {
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${fileId}/comments/${commentId}`,
      { body }
    )) as ApiResponse;
    return res.data;
  }

  async deleteComment(fileId: number, commentId: number): Promise<void> {
    await this.api.delete(
      `/2/drive/${this.driveId}/files/${fileId}/comments/${commentId}`
    );
  }

  async listFileActivities(fileId: number, options: ActivityOptions = {}): Promise<unknown> {
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/${fileId}/activities`,
      toQueryParams({
        cursor: options.cursor,
        limit: options.limit,
        order_by: options.orderBy,
        order: options.order,
        order_for: options.orderFor,
        actions: options.actions,
        depth: options.depth,
        from: options.from,
        terms: options.terms,
        until: options.until,
        users: options.users,
      })
    )) as ApiResponse;
    return res.data;
  }

  async listRecents(options: ListTrashOptions = {}): Promise<unknown> {
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/recents`,
      toQueryParams({
        cursor: options.cursor,
        limit: options.limit,
        order_by: options.orderBy,
        order: options.order,
        order_for: options.orderFor,
        type: options.type,
      })
    )) as ApiResponse;
    return res.data;
  }
}

interface ShareLinkOptions {
  right?: string;
  canComment?: boolean;
  canDownload?: boolean;
  canEdit?: boolean;
  canRequestAccess?: boolean;
  canSeeInfo?: boolean;
  canSeeStats?: boolean;
  password?: string;
  validUntil?: number;
}

interface PageOptions {
  page?: number;
  perPage?: number;
  total?: boolean;
  orderBy?: string;
  order?: "asc" | "desc";
  orderFor?: string;
}

interface CursorOptions {
  cursor?: string;
  limit?: number;
  orderBy?: string;
  order?: "asc" | "desc";
  orderFor?: string;
}

interface ListShareLinksOptions extends CursorOptions {
  right?: string;
  type?: string;
}

interface ListTrashOptions extends CursorOptions {
  type?: string;
}

interface ActivityOptions extends CursorOptions {
  actions?: string;
  depth?: number;
  from?: string;
  terms?: string;
  until?: string;
  users?: string;
}

function toShareLinkBody(options: ShareLinkOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  setIfDefined(body, "right", options.right);
  setIfDefined(body, "can_comment", options.canComment);
  setIfDefined(body, "can_download", options.canDownload);
  setIfDefined(body, "can_edit", options.canEdit);
  setIfDefined(body, "can_request_access", options.canRequestAccess);
  setIfDefined(body, "can_see_info", options.canSeeInfo);
  setIfDefined(body, "can_see_stats", options.canSeeStats);
  setIfDefined(body, "password", options.password);
  setIfDefined(body, "valid_until", options.validUntil);
  return body;
}

function toQueryParams(values: Record<string, string | number | boolean | undefined>): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params[key] = String(value);
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function setIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
