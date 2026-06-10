import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface TempResourceEntry {
  id: string;
  uri: string;
  filePath: string;
  name: string;
  mimeType?: string;
  description?: string;
  size: number;
  lastModified: string;
  createdAt: number;
  expiresAt: number;
}

export interface AddTempFileOptions {
  filePath: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface TempResourceRegistryOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class TempResourceRegistry {
  private readonly entries = new Map<string, TempResourceEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TempResourceRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 100;
    this.now = options.now ?? Date.now;
  }

  addFile(options: AddTempFileOptions): TempResourceEntry {
    this.pruneEntryLimit();
    const id = randomUUID();
    const stat = statSync(options.filePath);
    const createdAt = this.now();
    const entry = {
      id,
      uri: `infomaniak-temp://${id}`,
      filePath: options.filePath,
      name: options.name,
      mimeType: options.mimeType,
      description: options.description,
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.entries.set(id, entry);
    return entry;
  }

  async list() {
    await this.pruneExpired();
    return {
      resources: [...this.entries.values()].map((entry) => ({
        uri: entry.uri,
        name: entry.name,
        title: entry.name,
        description: entry.description,
        mimeType: entry.mimeType,
        size: entry.size,
        lastModified: entry.lastModified,
        expiresAt: new Date(entry.expiresAt).toISOString(),
      })),
    };
  }

  async read(uri: URL, id?: string) {
    const entryId = id ?? uri.hostname;
    await this.pruneExpired();
    const entry = this.entries.get(entryId);
    if (!entry) {
      throw new Error(`Unknown temporary resource: ${uri.toString()}`);
    }

    const content = await readFile(entry.filePath);
    if (isTextMime(entry.mimeType)) {
      return {
        contents: [{
          uri: entry.uri,
          mimeType: entry.mimeType,
          size: entry.size,
          lastModified: entry.lastModified,
          text: content.toString("utf8"),
        }],
      };
    }

    return {
      contents: [{
        uri: entry.uri,
        mimeType: entry.mimeType,
        size: entry.size,
        lastModified: entry.lastModified,
        blob: content.toString("base64"),
      }],
    };
  }

  async pruneExpired(): Promise<{ removed: number }> {
    const expired = this.collectExpiredEntries();
    await this.removeEntries(expired);
    return { removed: expired.length };
  }

  private collectExpiredEntries(): TempResourceEntry[] {
    const now = this.now();
    return [...this.entries.values()].filter((entry) => entry.expiresAt <= now);
  }

  private dropExpiredEntries(): void {
    for (const entry of this.collectExpiredEntries()) {
      this.entries.delete(entry.id);
    }
  }

  private pruneEntryLimit(): void {
    if (this.entries.size < this.maxEntries) return;
    const overflowCount = this.entries.size - this.maxEntries + 1;
    const oldest = [...this.entries.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, overflowCount);
    for (const entry of oldest) {
      this.entries.delete(entry.id);
      void rm(entry.filePath, { force: true });
    }
  }

  private async removeEntries(entries: TempResourceEntry[]): Promise<void> {
    await Promise.all(entries.map(async (entry) => {
      this.entries.delete(entry.id);
      await rm(entry.filePath, { force: true });
    }));
  }
}

export const defaultTempResourceRegistry = new TempResourceRegistry();

export function registerTempResourceTemplate(
  server: Pick<McpServer, "registerResource">,
  registry: TempResourceRegistry = defaultTempResourceRegistry
): void {
  server.registerResource(
    "infomaniak_temp_file",
    new ResourceTemplate("infomaniak-temp://{id}", {
      list: async () => registry.list(),
    }),
    {
      title: "Infomaniak temporary file",
      description: "Private temp files created by Infomaniak MCP download tools.",
    },
    async (uri, variables) => registry.read(uri, String(variables.id))
  );
}

function isTextMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.endsWith("+json");
}
