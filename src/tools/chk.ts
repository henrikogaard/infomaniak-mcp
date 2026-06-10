import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChkService } from "../services/chk.js";
import { textResult, jsonResult } from "../tool-handler.js";
import { arrayOutputSchema, destructiveTool, mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool, requireConfirmation, textOutputSchema } from "./register.js";

const shortUrlArrayOutputSchema = {
  data: z.array(z.object({
    id: z.string(),
    short_url: z.string(),
    long_url: z.string(),
  }).passthrough()),
};
const shortUrlPageOutputSchema = {
  items: shortUrlArrayOutputSchema.data,
  nextCursor: z.string().optional(),
  total: z.number(),
};

export function registerChkTools(server: McpServer, chk: ChkService) {
  registerStructuredTool(
    server,
    "chk_create_short_url",
    "Create a short URL using Infomaniak Chk. Returns the short URL and optionally a QR code.",
    {
      url: z.string().describe("The long URL to shorten"),
      custom_alias: z.string().optional().describe("Custom alias for the short URL"),
      expires_at: z.string().optional().describe("Expiration date (ISO 8601)"),
    },
    mutatingTool,
    async ({ url, custom_alias, expires_at }) => {
      const result = await chk.createShortUrl({ url, customAlias: custom_alias, expiresAt: expires_at });
      return jsonResult(result);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "chk_list_short_urls",
    "List all short URLs created with Infomaniak Chk",
    {},
    readOnlyTool,
    async () => {
      const urls = await chk.listShortUrls();
      return jsonResult(urls);
    },
    shortUrlArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "chk_list_short_urls_page",
    "List one cursor-style page of short URLs without changing the legacy array-returning list tool.",
    {
      limit: z.number().int().min(1).max(500).optional().describe("Maximum number of short URLs to return. Defaults to 100."),
      cursor: z.string().optional().describe("Opaque cursor returned by the previous page."),
    },
    readOnlyTool,
    async ({ limit, cursor }) => {
      const urls = await chk.listShortUrls();
      return jsonResult(paginateArray(urls, limit ?? 100, cursor));
    },
    shortUrlPageOutputSchema
  );

  registerStructuredTool(
    server,
    "chk_delete_short_url",
    "Delete a short URL. Requires exact confirmation: DELETE SHORT URL <id>.",
    {
      id: z.string().describe("Short URL ID to delete"),
      confirmation: z.string().describe("Exact confirmation phrase, e.g. DELETE SHORT URL abc123"),
    },
    destructiveTool,
    async ({ id, confirmation }) => {
      requireConfirmation(confirmation, `DELETE SHORT URL ${id}`);
      await chk.deleteShortUrl(id);
      return textResult(`Deleted short URL ${id}`);
    },
    textOutputSchema
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
