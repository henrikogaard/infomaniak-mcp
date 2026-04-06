import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KDriveService } from "../services/kdrive.js";

export function registerKDriveTools(server: McpServer, kdrive: KDriveService) {
  server.tool(
    "kdrive_search",
    "Search for files in kDrive by name or content",
    { query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (default 20)") },
    async ({ query, limit }) => {
      const files = await kdrive.searchFiles(query, limit);
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    }
  );

  server.tool(
    "kdrive_list_files",
    "List files in a kDrive folder",
    { folder_id: z.number().optional().describe("Folder ID (omit for root)") },
    async ({ folder_id }) => {
      const files = await kdrive.listFiles(folder_id ?? "root");
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    }
  );

  server.tool(
    "kdrive_get_file",
    "Get metadata for a specific file in kDrive",
    { file_id: z.number().describe("File ID") },
    async ({ file_id }) => {
      const meta = await kdrive.getFileMetadata(file_id);
      return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }] };
    }
  );

  server.tool(
    "kdrive_download_file",
    "Download a file from kDrive (returns base64-encoded content)",
    { file_id: z.number().describe("File ID") },
    async ({ file_id }) => {
      const meta = await kdrive.getFileMetadata(file_id);
      const data = await kdrive.downloadFile(file_id);
      return {
        content: [
          { type: "text", text: `File: ${(meta as Record<string, unknown>).name}\nBase64 content:\n${data}` },
        ],
      };
    }
  );

  server.tool(
    "kdrive_create_folder",
    "Create a new folder in kDrive",
    {
      parent_id: z.number().describe("Parent folder ID"),
      name: z.string().describe("Folder name"),
    },
    async ({ parent_id, name }) => {
      const folder = await kdrive.createFolder(parent_id, name);
      return { content: [{ type: "text", text: JSON.stringify(folder, null, 2) }] };
    }
  );

  server.tool(
    "kdrive_delete",
    "Delete a file or folder from kDrive",
    { file_id: z.number().describe("File or folder ID to delete") },
    async ({ file_id }) => {
      await kdrive.deleteFile(file_id);
      return { content: [{ type: "text", text: `Deleted file/folder ${file_id}` }] };
    }
  );

  server.tool(
    "kdrive_move",
    "Move a file or folder to a different location in kDrive",
    {
      file_id: z.number().describe("File/folder ID to move"),
      destination_folder_id: z.number().describe("Destination folder ID"),
    },
    async ({ file_id, destination_folder_id }) => {
      const result = await kdrive.moveFile(file_id, destination_folder_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "kdrive_rename",
    "Rename a file or folder in kDrive",
    {
      file_id: z.number().describe("File/folder ID to rename"),
      name: z.string().describe("New name"),
    },
    async ({ file_id, name }) => {
      const result = await kdrive.renameFile(file_id, name);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
