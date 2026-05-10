import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KDriveService } from "../services/kdrive.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerKDriveTools(server: McpServer, kdrive: KDriveService) {
  server.tool(
    "kdrive_search",
    "Search for files in kDrive by name or content",
    { query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (default 20)") },
    safeHandler(async ({ query, limit }) => {
      const files = await kdrive.searchFiles(query, limit);
      return jsonResult(files);
    })
  );

  server.tool(
    "kdrive_list_files",
    "List files and folders in a kDrive directory. Returns both files and folders with metadata.",
    { folder_id: z.number().optional().describe("Folder ID (omit for root)") },
    safeHandler(async ({ folder_id }) => {
      const files = await kdrive.listFiles(folder_id ?? "root");
      return jsonResult(files);
    })
  );

  server.tool(
    "kdrive_get_file",
    "Get metadata for a specific file in kDrive",
    { file_id: z.number().describe("File ID") },
    safeHandler(async ({ file_id }) => {
      const meta = await kdrive.getFileMetadata(file_id);
      return jsonResult(meta);
    })
  );

  server.tool(
    "kdrive_download_file",
    "Download a file from kDrive. Returns base64-encoded content. Warning: large files (>10MB) may cause issues.",
    { file_id: z.number().describe("File ID") },
    safeHandler(async ({ file_id }) => {
      const meta = await kdrive.getFileMetadata(file_id);
      const sizeMb = ((meta.size ?? 0) / 1024 / 1024);
      if (sizeMb > 50) {
        return textResult(`File "${meta.name}" is ${sizeMb.toFixed(1)}MB — too large to download via MCP. Use kDrive web interface instead.`);
      }
      const data = await kdrive.downloadFile(file_id);
      return textResult(`File: ${meta.name} (${sizeMb.toFixed(1)}MB)\nBase64 content:\n${data}`);
    })
  );

  server.tool(
    "kdrive_upload_file",
    "Upload a file to kDrive. Content must be base64-encoded.",
    {
      folder_id: z.number().describe("Parent folder ID to upload into"),
      filename: z.string().describe("Name for the uploaded file"),
      base64_content: z.string().describe("Base64-encoded file content"),
    },
    safeHandler(async ({ folder_id, filename, base64_content }) => {
      const result = await kdrive.uploadFile(folder_id, filename, base64_content);
      return jsonResult(result);
    })
  );

  server.tool(
    "kdrive_create_folder",
    "Create a new folder in kDrive",
    {
      parent_id: z.number().describe("Parent folder ID"),
      name: z.string().describe("Folder name"),
    },
    safeHandler(async ({ parent_id, name }) => {
      const folder = await kdrive.createFolder(parent_id, name);
      return jsonResult(folder);
    })
  );

  server.tool(
    "kdrive_delete",
    "Delete a file or folder from kDrive (moves to trash)",
    { file_id: z.number().describe("File or folder ID to delete") },
    safeHandler(async ({ file_id }) => {
      await kdrive.deleteFile(file_id);
      return textResult(`Deleted file/folder ${file_id}`);
    })
  );

  server.tool(
    "kdrive_move",
    "Move a file or folder to a different location in kDrive",
    {
      file_id: z.number().describe("File/folder ID to move"),
      destination_folder_id: z.number().describe("Destination folder ID"),
    },
    safeHandler(async ({ file_id, destination_folder_id }) => {
      const result = await kdrive.moveFile(file_id, destination_folder_id);
      return jsonResult(result);
    })
  );

  server.tool(
    "kdrive_rename",
    "Rename a file or folder in kDrive",
    {
      file_id: z.number().describe("File/folder ID to rename"),
      name: z.string().describe("New name"),
    },
    safeHandler(async ({ file_id, name }) => {
      const result = await kdrive.renameFile(file_id, name);
      return jsonResult(result);
    })
  );

  server.tool(
    "kdrive_get_share_link",
    "Get the public share-link configuration for a kDrive file or folder",
    { file_id: z.number().describe("File or folder ID") },
    safeHandler(async ({ file_id }) => {
      return jsonResult(await kdrive.getShareLink(file_id));
    })
  );

  server.tool(
    "kdrive_create_share_link",
    "Create a public share link for a kDrive file or folder, with optional permissions, password, and expiry",
    shareLinkSchema,
    safeHandler(async ({ file_id, right, can_comment, can_download, can_edit, can_request_access, can_see_info, can_see_stats, password, valid_until }) => {
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
    })
  );

  server.tool(
    "kdrive_update_share_link",
    "Update an existing kDrive share link's permissions, password, or expiry",
    shareLinkSchema,
    safeHandler(async ({ file_id, right, can_comment, can_download, can_edit, can_request_access, can_see_info, can_see_stats, password, valid_until }) => {
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
    })
  );

  server.tool(
    "kdrive_delete_share_link",
    "Remove the public share link from a kDrive file or folder",
    { file_id: z.number().describe("File or folder ID") },
    safeHandler(async ({ file_id }) => {
      await kdrive.deleteShareLink(file_id);
      return textResult(`Removed share link for file/folder ${file_id}`);
    })
  );

  server.tool(
    "kdrive_list_share_links",
    "List files and folders in this kDrive that currently have share links",
    {
      ...cursorListShape,
      right: z.string().optional().describe("Filter by share-link right, such as public"),
      type: z.string().optional().describe("Filter by item type, such as file or dir"),
    },
    safeHandler(async ({ cursor, limit, order_by, order, order_for, right, type }) => {
      return jsonResult(await kdrive.listShareLinks({
        cursor,
        limit,
        orderBy: order_by,
        order,
        orderFor: order_for,
        right,
        type,
      }));
    })
  );

  server.tool(
    "kdrive_list_versions",
    "List saved versions for a kDrive file",
    {
      ...pageListShape,
      file_id: z.number().describe("File ID"),
    },
    safeHandler(async ({ file_id, page, per_page, total, order_by, order, order_for }) => {
      return jsonResult(await kdrive.listVersions(file_id, {
        page,
        perPage: per_page,
        total,
        orderBy: order_by,
        order,
        orderFor: order_for,
      }));
    })
  );

  server.tool(
    "kdrive_restore_version",
    "Restore a previous kDrive file version in place",
    {
      file_id: z.number().describe("File ID"),
      version_id: z.union([z.number(), z.string()]).describe("Version ID to restore"),
    },
    safeHandler(async ({ file_id, version_id }) => {
      return jsonResult(await kdrive.restoreVersion(file_id, version_id));
    })
  );

  server.tool(
    "kdrive_restore_version_to_folder",
    "Restore a previous kDrive file version as a copy in another folder",
    {
      file_id: z.number().describe("File ID"),
      version_id: z.union([z.number(), z.string()]).describe("Version ID to restore"),
      destination_folder_id: z.number().describe("Destination folder ID"),
      name: z.string().optional().describe("Optional filename for the restored copy"),
    },
    safeHandler(async ({ file_id, version_id, destination_folder_id, name }) => {
      return jsonResult(await kdrive.restoreVersionToDirectory(file_id, version_id, destination_folder_id, name));
    })
  );

  server.tool(
    "kdrive_list_trash",
    "List files and folders in the kDrive trash",
    {
      ...cursorListShape,
      type: z.string().optional().describe("Filter by item type, such as file or dir"),
    },
    safeHandler(async ({ cursor, limit, order_by, order, order_for, type }) => {
      return jsonResult(await kdrive.listTrash({
        cursor,
        limit,
        orderBy: order_by,
        order,
        orderFor: order_for,
        type,
      }));
    })
  );

  server.tool(
    "kdrive_restore_from_trash",
    "Restore a kDrive file or folder from trash, optionally into a destination folder",
    {
      file_id: z.number().describe("Trashed file or folder ID"),
      destination_folder_id: z.number().optional().describe("Optional destination folder ID"),
    },
    safeHandler(async ({ file_id, destination_folder_id }) => {
      return jsonResult(await kdrive.restoreFromTrash(file_id, destination_folder_id));
    })
  );

  server.tool(
    "kdrive_list_comments",
    "List comments on a kDrive file",
    {
      ...pageListShape,
      file_id: z.number().describe("File ID"),
    },
    safeHandler(async ({ file_id, page, per_page, total, order_by, order, order_for }) => {
      return jsonResult(await kdrive.listComments(file_id, {
        page,
        perPage: per_page,
        total,
        orderBy: order_by,
        order,
        orderFor: order_for,
      }));
    })
  );

  server.tool(
    "kdrive_add_comment",
    "Add a comment to a kDrive file",
    {
      file_id: z.number().describe("File ID"),
      body: z.string().describe("Comment body"),
    },
    safeHandler(async ({ file_id, body }) => {
      return jsonResult(await kdrive.addComment(file_id, body));
    })
  );

  server.tool(
    "kdrive_reply_comment",
    "Reply to an existing kDrive file comment",
    {
      file_id: z.number().describe("File ID"),
      comment_id: z.number().describe("Comment ID"),
      body: z.string().describe("Reply body"),
    },
    safeHandler(async ({ file_id, comment_id, body }) => {
      return jsonResult(await kdrive.replyToComment(file_id, comment_id, body));
    })
  );

  server.tool(
    "kdrive_delete_comment",
    "Delete a comment from a kDrive file",
    {
      file_id: z.number().describe("File ID"),
      comment_id: z.number().describe("Comment ID"),
    },
    safeHandler(async ({ file_id, comment_id }) => {
      await kdrive.deleteComment(file_id, comment_id);
      return textResult(`Deleted comment ${comment_id} from file ${file_id}`);
    })
  );

  server.tool(
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
    safeHandler(async ({ file_id, cursor, limit, order_by, order, order_for, actions, depth, from, terms, until, users }) => {
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
    })
  );

  server.tool(
    "kdrive_list_recents",
    "List the most recently used files and folders in kDrive",
    {
      ...cursorListShape,
      type: z.string().optional().describe("Filter by item type, such as file or dir"),
    },
    safeHandler(async ({ cursor, limit, order_by, order, order_for, type }) => {
      return jsonResult(await kdrive.listRecents({
        cursor,
        limit,
        orderBy: order_by,
        order,
        orderFor: order_for,
        type,
      }));
    })
  );
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
