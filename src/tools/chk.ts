import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChkService } from "../services/chk.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerChkTools(server: McpServer, chk: ChkService) {
  server.tool(
    "chk_create_short_url",
    "Create a short URL using Infomaniak Chk. Returns the short URL and optionally a QR code.",
    {
      url: z.string().describe("The long URL to shorten"),
      custom_alias: z.string().optional().describe("Custom alias for the short URL"),
      expires_at: z.string().optional().describe("Expiration date (ISO 8601)"),
    },
    safeHandler(async ({ url, custom_alias, expires_at }) => {
      const result = await chk.createShortUrl({ url, customAlias: custom_alias, expiresAt: expires_at });
      return jsonResult(result);
    })
  );

  server.tool(
    "chk_list_short_urls",
    "List all short URLs created with Infomaniak Chk",
    {},
    safeHandler(async () => {
      const urls = await chk.listShortUrls();
      return jsonResult(urls);
    })
  );

  server.tool(
    "chk_delete_short_url",
    "Delete a short URL",
    { id: z.string().describe("Short URL ID to delete") },
    safeHandler(async ({ id }) => {
      await chk.deleteShortUrl(id);
      return textResult(`Deleted short URL ${id}`);
    })
  );
}
