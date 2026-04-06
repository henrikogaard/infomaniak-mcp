import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse {
  data?: unknown;
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

export class KDriveService {
  private api: InfomaniakAPI;
  private driveId: string;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
    this.driveId = config.kdriveId;
  }

  async searchFiles(query: string, limit = 20): Promise<FileEntry[]> {
    const res = (await this.api.get(`/3/drive/${this.driveId}/files/search`, {
      query,
      limit: String(limit),
    })) as ApiResponse;
    return (res.data ?? []) as FileEntry[];
  }

  async listFiles(folderId: string | number = "root"): Promise<FileEntry[]> {
    const id = folderId === "root" ? 1 : folderId;
    const res = (await this.api.get(
      `/3/drive/${this.driveId}/files/${id}/files`
    )) as ApiResponse;
    return (res.data ?? []) as FileEntry[];
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
    const boundary = `----FormBoundary${Date.now()}`;

    const parts: Buffer[] = [];
    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      "Content-Type: application/octet-stream",
      "",
      "",
    ].join("\r\n");
    parts.push(Buffer.from(header));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const res = await this.api.uploadRaw(
      `/2/drive/${this.driveId}/files/${folderId}/upload`,
      body,
      `multipart/form-data; boundary=${boundary}`
    );
    return (res as ApiResponse).data as FileEntry;
  }

  async createFolder(parentId: number, name: string): Promise<FileEntry> {
    const res = (await this.api.post(
      `/2/drive/${this.driveId}/files/${parentId}/folder`,
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
    const res = (await this.api.put(
      `/2/drive/${this.driveId}/files/${fileId}/rename`,
      { name }
    )) as ApiResponse;
    return res.data as FileEntry;
  }
}
