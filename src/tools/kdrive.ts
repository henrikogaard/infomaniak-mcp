import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KDriveService } from "../services/kdrive.js";
import { textResult, jsonResult, structuredResult } from "../tool-handler.js";
import { defaultTempResourceRegistry, type TempResourceRegistry } from "../temp-resources.js";
import { arrayOutputSchema, destructiveTool, mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool, requireConfirmation, textOutputSchema } from "./register.js";

const DEFAULT_DOWNLOAD_INLINE_LIMIT = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const kdriveItemOutputSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  type: z.string(),
}).passthrough();
const kdriveItemArrayOutputSchema = {
  data: z.array(kdriveItemOutputSchema),
};
const kdrivePageOutputSchema = {
  items: z.array(kdriveItemOutputSchema),
  nextCursor: z.string().optional(),
  total: z.number(),
};

interface KDriveToolOptions {
  tempResources?: TempResourceRegistry;
}

export function registerKDriveTools(server: McpServer, kdrive: KDriveService, options: KDriveToolOptions = {}) {
  const tempResources = options.tempResources ?? defaultTempResourceRegistry;

  registerStructuredTool(
    server,
    "kdrive_search",
    "Search for files in kDrive by name or content",
    { query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (default 20)") },
    readOnlyTool,
    async ({ query, limit }) => {
      const files = await kdrive.searchFiles(query, limit);
      return jsonResult(files);
    },
    kdriveItemArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_files",
    "List files and folders in a kDrive directory. Returns both files and folders with metadata.",
    { folder_id: z.number().optional().describe("Folder ID (omit for root)") },
    readOnlyTool,
    async ({ folder_id }) => {
      const files = await kdrive.listFiles(folder_id ?? "root");
      return jsonResult(files);
    },
    kdriveItemArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_files_page",
    "List one cursor-style page of files and folders in a kDrive directory without changing the legacy array-returning list tool.",
    {
      folder_id: z.number().optional().describe("Folder ID (omit for root)"),
      limit: z.number().int().min(1).max(500).optional().describe("Maximum number of items to return. Defaults to 100."),
      cursor: z.string().optional().describe("Opaque cursor returned by the previous page."),
    },
    readOnlyTool,
    async ({ folder_id, limit, cursor }) => {
      const files = await kdrive.listFiles(folder_id ?? "root");
      return structuredResult(paginateArray(files, limit ?? 100, cursor));
    },
    kdrivePageOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_get_file",
    "Get metadata for a specific file in kDrive",
    { file_id: z.number().describe("File ID") },
    readOnlyTool,
    async ({ file_id }) => {
      const meta = await kdrive.getFileMetadata(file_id);
      return jsonResult(meta);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_download_file",
    "Download a file from kDrive. Small files can be returned as base64; large files are saved to a temp file and returned as a resource link.",
    {
      file_id: z.number().describe("File ID"),
      include_base64: z.boolean().optional().describe("Return base64 inline when the file is within max_inline_bytes. Defaults to false for large files."),
      max_inline_bytes: z.number().int().min(1).max(10 * 1024 * 1024).optional().describe("Maximum size allowed for inline base64. Defaults to 1 MiB."),
    },
    readOnlyTool,
    async ({ file_id, include_base64, max_inline_bytes }) => {
      const meta = await kdrive.getFileMetadata(file_id);
      const size = meta.size ?? 0;
      const sizeMb = size / 1024 / 1024;
      if (size > MAX_DOWNLOAD_BYTES) {
        return textResult(`File "${meta.name}" is ${sizeMb.toFixed(1)}MB — too large to download via MCP. Use kDrive web interface instead.`);
      }
      const data = await kdrive.downloadFile(file_id);
      const maxInlineBytes = max_inline_bytes ?? DEFAULT_DOWNLOAD_INLINE_LIMIT;
      const shouldInline = include_base64 === true || size <= maxInlineBytes;
      if (shouldInline) {
        if (size > maxInlineBytes) {
          throw new Error(`File is ${size} bytes; max_inline_bytes is ${maxInlineBytes}. Retry without include_base64 to save it as a temp file.`);
        }
        return structuredResult({
          id: file_id,
          name: meta.name,
          type: meta.type,
          size,
          contentBase64: data,
        }, `File: ${meta.name} (${sizeMb.toFixed(1)}MB)\nBase64 content:\n${data}`);
      }

      const saved = await saveKDriveDownloadToTempFile(meta.name, data, tempResources, inferMimeType(meta.name));
      return structuredResult(
        {
          id: file_id,
          name: meta.name,
          type: meta.type,
          size,
          filePath: saved.filePath,
          fileUri: saved.fileUri,
          resourceUri: saved.resourceUri,
        },
        `File saved: ${saved.filePath}`,
        [{
          type: "resource_link",
          uri: saved.resourceUri,
          name: meta.name,
          description: `Saved kDrive download (${size} bytes)`,
          mimeType: inferMimeType(meta.name),
        }]
      );
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_upload_file",
    "Upload a file to kDrive. Content must be base64-encoded.",
    {
      folder_id: z.number().describe("Parent folder ID to upload into"),
      filename: z.string().describe("Name for the uploaded file"),
      base64_content: z.string().describe("Base64-encoded file content"),
    },
    mutatingTool,
    async ({ folder_id, filename, base64_content }) => {
      const result = await kdrive.uploadFile(folder_id, filename, base64_content);
      return jsonResult(result);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_create_folder",
    "Create a new folder in kDrive",
    {
      parent_id: z.number().describe("Parent folder ID"),
      name: z.string().describe("Folder name"),
    },
    mutatingTool,
    async ({ parent_id, name }) => {
      const folder = await kdrive.createFolder(parent_id, name);
      return jsonResult(folder);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_delete",
    "Delete a file or folder from kDrive (moves to trash). Requires exact confirmation: MOVE <file_id> TO TRASH.",
    {
      file_id: z.number().describe("File or folder ID to delete"),
      confirmation: z.string().describe("Exact confirmation phrase, e.g. MOVE 123 TO TRASH"),
    },
    destructiveTool,
    async ({ file_id, confirmation }) => {
      requireConfirmation(confirmation, `MOVE ${file_id} TO TRASH`);
      await kdrive.deleteFile(file_id);
      return textResult(`Deleted file/folder ${file_id}`);
    },
    textOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_move",
    "Move a file or folder to a different location in kDrive",
    {
      file_id: z.number().describe("File/folder ID to move"),
      destination_folder_id: z.number().describe("Destination folder ID"),
    },
    mutatingTool,
    async ({ file_id, destination_folder_id }) => {
      const result = await kdrive.moveFile(file_id, destination_folder_id);
      return jsonResult(result);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_rename",
    "Rename a file or folder in kDrive",
    {
      file_id: z.number().describe("File/folder ID to rename"),
      name: z.string().describe("New name"),
    },
    mutatingTool,
    async ({ file_id, name }) => {
      const result = await kdrive.renameFile(file_id, name);
      return jsonResult(result);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_get_share_link",
    "Get the public share-link configuration for a kDrive file or folder",
    { file_id: z.number().describe("File or folder ID") },
    readOnlyTool,
    async ({ file_id }) => {
      return jsonResult(await kdrive.getShareLink(file_id));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_create_share_link",
    "Create a public share link for a kDrive file or folder, with optional permissions, password, and expiry",
    shareLinkSchema,
    mutatingTool,
    async ({ file_id, right, can_comment, can_download, can_edit, can_request_access, can_see_info, can_see_stats, password, valid_until }) => {
      return jsonResult(await kdrive.createShareLink(file_id, {
        right,
        canComment: can_comment,
        canDownload: can_download,
        canEdit: can_edit,
        canRequestAccess: can_request_access,
        canSeeInfo: can_see_info,
        canSeeStats: can_see_stats,
        password,
        validUntil: valid_until,
      }));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_update_share_link",
    "Update an existing kDrive share link's permissions, password, or expiry",
    shareLinkSchema,
    mutatingTool,
    async ({ file_id, right, can_comment, can_download, can_edit, can_request_access, can_see_info, can_see_stats, password, valid_until }) => {
      return jsonResult(await kdrive.updateShareLink(file_id, {
        right,
        canComment: can_comment,
        canDownload: can_download,
        canEdit: can_edit,
        canRequestAccess: can_request_access,
        canSeeInfo: can_see_info,
        canSeeStats: can_see_stats,
        password,
        validUntil: valid_until,
      }));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_delete_share_link",
    "Remove the public share link from a kDrive file or folder. Requires exact confirmation: DELETE SHARE LINK <file_id>.",
    {
      file_id: z.number().describe("File or folder ID"),
      confirmation: z.string().describe("Exact confirmation phrase, e.g. DELETE SHARE LINK 123"),
    },
    destructiveTool,
    async ({ file_id, confirmation }) => {
      requireConfirmation(confirmation, `DELETE SHARE LINK ${file_id}`);
      await kdrive.deleteShareLink(file_id);
      return textResult(`Removed share link for file/folder ${file_id}`);
    },
    textOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_share_links",
    "List files and folders in this kDrive that currently have share links",
    {
      ...cursorListShape,
      right: z.string().optional().describe("Filter by share-link right, such as public"),
      type: z.string().optional().describe("Filter by item type, such as file or dir"),
    },
    readOnlyTool,
    async ({ cursor, limit, order_by, order, order_for, right, type }) => {
      return jsonResult(await kdrive.listShareLinks({
        cursor,
        limit,
        orderBy: order_by,
        order,
        orderFor: order_for,
        right,
        type,
      }));
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_versions",
    "List saved versions for a kDrive file",
    {
      ...pageListShape,
      file_id: z.number().describe("File ID"),
    },
    readOnlyTool,
    async ({ file_id, page, per_page, total, order_by, order, order_for }) => {
      return jsonResult(await kdrive.listVersions(file_id, {
        page,
        perPage: per_page,
        total,
        orderBy: order_by,
        order,
        orderFor: order_for,
      }));
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_restore_version",
    "Restore a previous kDrive file version in place",
    {
      file_id: z.number().describe("File ID"),
      version_id: z.union([z.number(), z.string()]).describe("Version ID to restore"),
    },
    mutatingTool,
    async ({ file_id, version_id }) => {
      return jsonResult(await kdrive.restoreVersion(file_id, version_id));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_restore_version_to_folder",
    "Restore a previous kDrive file version as a copy in another folder",
    {
      file_id: z.number().describe("File ID"),
      version_id: z.union([z.number(), z.string()]).describe("Version ID to restore"),
      destination_folder_id: z.number().describe("Destination folder ID"),
      name: z.string().optional().describe("Optional filename for the restored copy"),
    },
    mutatingTool,
    async ({ file_id, version_id, destination_folder_id, name }) => {
      return jsonResult(await kdrive.restoreVersionToDirectory(file_id, version_id, destination_folder_id, name));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_trash",
    "List files and folders in the kDrive trash",
    {
      ...cursorListShape,
      type: z.string().optional().describe("Filter by item type, such as file or dir"),
    },
    readOnlyTool,
    async ({ cursor, limit, order_by, order, order_for, type }) => {
      return jsonResult(await kdrive.listTrash({
        cursor,
        limit,
        orderBy: order_by,
        order,
        orderFor: order_for,
        type,
      }));
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_restore_from_trash",
    "Restore a kDrive file or folder from trash, optionally into a destination folder",
    {
      file_id: z.number().describe("Trashed file or folder ID"),
      destination_folder_id: z.number().optional().describe("Optional destination folder ID"),
    },
    mutatingTool,
    async ({ file_id, destination_folder_id }) => {
      return jsonResult(await kdrive.restoreFromTrash(file_id, destination_folder_id));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_comments",
    "List comments on a kDrive file",
    {
      ...pageListShape,
      file_id: z.number().describe("File ID"),
    },
    readOnlyTool,
    async ({ file_id, page, per_page, total, order_by, order, order_for }) => {
      return jsonResult(await kdrive.listComments(file_id, {
        page,
        perPage: per_page,
        total,
        orderBy: order_by,
        order,
        orderFor: order_for,
      }));
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_add_comment",
    "Add a comment to a kDrive file",
    {
      file_id: z.number().describe("File ID"),
      body: z.string().describe("Comment body"),
    },
    mutatingTool,
    async ({ file_id, body }) => {
      return jsonResult(await kdrive.addComment(file_id, body));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_reply_comment",
    "Reply to an existing kDrive file comment",
    {
      file_id: z.number().describe("File ID"),
      comment_id: z.number().describe("Comment ID"),
      body: z.string().describe("Reply body"),
    },
    mutatingTool,
    async ({ file_id, comment_id, body }) => {
      return jsonResult(await kdrive.replyToComment(file_id, comment_id, body));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_delete_comment",
    "Delete a comment from a kDrive file. Requires exact confirmation: DELETE COMMENT <comment_id> FROM FILE <file_id>.",
    {
      file_id: z.number().describe("File ID"),
      comment_id: z.number().describe("Comment ID"),
      confirmation: z.string().describe("Exact confirmation phrase, e.g. DELETE COMMENT 456 FROM FILE 123"),
    },
    destructiveTool,
    async ({ file_id, comment_id, confirmation }) => {
      requireConfirmation(confirmation, `DELETE COMMENT ${comment_id} FROM FILE ${file_id}`);
      await kdrive.deleteComment(file_id, comment_id);
      return textResult(`Deleted comment ${comment_id} from file ${file_id}`);
    },
    textOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_file_activities",
    "List recent activity for a kDrive file or folder",
    {
      ...cursorListShape,
      file_id: z.number().describe("File or folder ID"),
      actions: z.string().optional().describe("Optional action filter accepted by the Infomaniak API"),
      depth: z.number().optional().describe("Optional traversal depth for folder activity"),
      from: z.string().optional().describe("Optional start date/time filter"),
      terms: z.string().optional().describe("Optional search terms"),
      until: z.string().optional().describe("Optional end date/time filter"),
      users: z.string().optional().describe("Optional user filter accepted by the Infomaniak API"),
    },
    readOnlyTool,
    async ({ file_id, cursor, limit, order_by, order, order_for, actions, depth, from, terms, until, users }) => {
      return jsonResult(await kdrive.listFileActivities(file_id, {
        cursor,
        limit,
        orderBy: order_by,
        order,
        orderFor: order_for,
        actions,
        depth,
        from,
        terms,
        until,
        users,
      }));
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kdrive_list_recents",
    "List the most recently used files and folders in kDrive",
    {
      ...cursorListShape,
      type: z.string().optional().describe("Filter by item type, such as file or dir"),
    },
    readOnlyTool,
    async ({ cursor, limit, order_by, order, order_for, type }) => {
      return jsonResult(await kdrive.listRecents({
        cursor,
        limit,
        orderBy: order_by,
        order,
        orderFor: order_for,
        type,
      }));
    },
    kdriveItemArrayOutputSchema
  );
}

function paginateArray<T>(items: T[], limit: number, cursor?: string): { items: T[]; nextCursor?: string; total: number } {
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const offset = parseCursor(cursor);
  const page = items.slice(offset, offset + safeLimit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
    total: items.length,
  };
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

const orderSchema = z.enum(["asc", "desc"]).optional().describe("Sort direction");

const pageListShape = {
  page: z.number().optional().describe("Page number"),
  per_page: z.number().optional().describe("Items per page"),
  total: z.boolean().optional().describe("Ask the API to include total count metadata"),
  order_by: z.string().optional().describe("Sort field"),
  order: orderSchema,
  order_for: z.string().optional().describe("Sort context accepted by the Infomaniak API"),
};

const cursorListShape = {
  cursor: z.string().optional().describe("Pagination cursor"),
  limit: z.number().optional().describe("Maximum number of items to return"),
  order_by: z.string().optional().describe("Sort field"),
  order: orderSchema,
  order_for: z.string().optional().describe("Sort context accepted by the Infomaniak API"),
};

const shareLinkSchema = {
  file_id: z.number().describe("File or folder ID"),
  right: z.string().optional().describe("Share right, usually public"),
  can_comment: z.boolean().optional().describe("Allow comments through the share link"),
  can_download: z.boolean().optional().describe("Allow downloads through the share link"),
  can_edit: z.boolean().optional().describe("Allow editing through the share link"),
  can_request_access: z.boolean().optional().describe("Allow viewers to request access"),
  can_see_info: z.boolean().optional().describe("Allow viewers to see file info"),
  can_see_stats: z.boolean().optional().describe("Allow viewers to see stats"),
  password: z.string().optional().describe("Optional share-link password"),
  valid_until: z.number().optional().describe("Optional API valid_until value for link expiry"),
};

async function saveKDriveDownloadToTempFile(
  filename: string,
  contentBase64: string,
  tempResources: TempResourceRegistry,
  mimeType: string | undefined
): Promise<{ filePath: string; fileUri: string; resourceUri: string }> {
  const directory = join(tmpdir(), "infomaniak-mcp-kdrive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const filePath = join(directory, `${randomUUID()}-${sanitizeFilename(filename)}`);
  await writeFile(filePath, Buffer.from(contentBase64, "base64"), { mode: 0o600, flag: "wx" });
  const resource = tempResources.addFile({
    filePath,
    name: filename,
    mimeType,
    description: "Saved kDrive download",
  });
  return {
    filePath,
    fileUri: `file://${filePath}`,
    resourceUri: resource.uri,
  };
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "download";
}

function inferMimeType(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}
