import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KPasteService } from "../services/kpaste.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerKPasteTools(server: McpServer, kpaste: KPasteService) {
  server.tool(
    "kpaste_create",
    "Create an encrypted, ephemeral paste on kPaste (zero-knowledge, AES-256-GCM). Returns a one-time URL. Great for sharing passwords and secrets securely. The encryption key is in the URL fragment (#) and never sent to the server.",
    {
      content: z.string().describe("The text/secret to share"),
      expiration: z
        .enum(["5min", "1hour", "1day", "1week", "1month"])
        .optional()
        .describe("When the paste expires (default: 1day)"),
      burn_after_reading: z
        .boolean()
        .optional()
        .describe("Auto-delete after first read (default: false)"),
    },
    safeHandler(async ({ content, expiration, burn_after_reading }) => {
      const result = await kpaste.createPaste({
        content,
        expiration,
        burnAfterReading: burn_after_reading,
      });
      return textResult(`Encrypted paste created!\n\nURL: ${result.url}\nID: ${result.id}\n\nThe encryption key is in the URL fragment (#) and is never sent to the server.`);
    })
  );
}
