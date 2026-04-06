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
  private token: string;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
    this.driveId = config.kdriveId;
    this.token = config.infomaniakToken;
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
}
