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
}
