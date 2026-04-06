import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SwissTransferService } from "../services/swisstransfer.js";

export function registerSwissTransferTools(server: McpServer, st: SwissTransferService) {
  server.tool(
    "swisstransfer_send",
    "Send files via Swiss Transfer (encrypted, up to 50GB). Returns a download link.",
    {
      files: z.array(z.object({
        name: z.string().describe("Filename"),
        base64_content: z.string().describe("Base64-encoded file content"),
      })).describe("Files to transfer"),
      message: z.string().optional().describe("Message to include with the transfer"),
      recipients: z.array(z.string()).optional().describe("Email addresses of recipients"),
      password: z.string().optional().describe("Password to protect the transfer"),
      expiration_days: z.number().optional().describe("Days until expiration (default: 30)"),
      download_limit: z.number().optional().describe("Max number of downloads (0 = unlimited)"),
    },
    async ({ files, message, recipients, password, expiration_days, download_limit }) => {
      const result = await st.createTransfer({
        files: files.map((f) => ({ name: f.name, base64Content: f.base64_content })),
        message, recipients, password,
        expirationDays: expiration_days,
        downloadLimit: download_limit,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "swisstransfer_info",
    "Get information about a Swiss Transfer",
    { transfer_id: z.string().describe("Transfer ID") },
    async ({ transfer_id }) => {
      const info = await st.getTransferInfo(transfer_id);
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
  );
}
