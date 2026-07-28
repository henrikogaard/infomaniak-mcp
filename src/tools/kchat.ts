import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KChatService } from "../services/kchat.js";
import { jsonResult, withUntrustedContent } from "../tool-handler.js";
import { arrayOutputSchema, mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool, requireExternalConfirmation, type ToolRegistrationOptions } from "./register.js";

const kchatHistoryOutputSchema = z.object({
  posts: z.record(z.string(), z.unknown()),
  order: z.array(z.string()),
}).passthrough();

export function registerKChatTools(server: McpServer, kchat: KChatService, options: ToolRegistrationOptions = {}) {
  registerStructuredTool(
    server,
    "kchat_list_channels",
    "List public kChat channels for the configured team",
    listSchema,
    readOnlyTool,
    async ({ limit, page }) => {
      return jsonResult(await kchat.listChannels({ limit, page }));
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_post_message",
    "Post a new message to a kChat channel",
    {
      channel_id: z.string().describe("kChat channel ID"),
      text: z.string().describe("Message text"),
      file_ids: z.array(z.string()).optional().describe("Optional uploaded kChat file IDs to attach"),
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: POST KCHAT MESSAGE TO <channel_id>"),
    },
    mutatingTool,
    async ({ channel_id, text, file_ids, confirmation }) => {
      requireExternalConfirmation(options, confirmation, `POST KCHAT MESSAGE TO ${channel_id}`);
      return jsonResult(await kchat.postMessage(channel_id, text, undefined, file_ids));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_reply_to_thread",
    "Reply to a kChat message thread",
    {
      thread_id: z.string().describe("Parent post ID"),
      text: z.string().describe("Reply text"),
      file_ids: z.array(z.string()).optional().describe("Optional uploaded kChat file IDs to attach"),
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: REPLY KCHAT THREAD <thread_id>"),
    },
    mutatingTool,
    async ({ thread_id, text, file_ids, confirmation }) => {
      requireExternalConfirmation(options, confirmation, `REPLY KCHAT THREAD ${thread_id}`);
      return jsonResult(await kchat.replyToThread(thread_id, text, file_ids));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_add_reaction",
    "Add an emoji reaction to a kChat message",
    {
      post_id: z.string().describe("Post ID"),
      emoji_name: z.string().describe("Emoji name without surrounding colons"),
    },
    mutatingTool,
    async ({ post_id, emoji_name }) => {
      return jsonResult(await kchat.addReaction(post_id, emoji_name));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_get_channel_history",
    "Get recent posts from a kChat channel",
    {
      channel_id: z.string().describe("Channel ID"),
      limit: z.number().optional().describe("Maximum number of posts to return"),
      page: z.number().optional().describe("Pagination page"),
    },
    readOnlyTool,
    async ({ channel_id, limit, page }) => {
      return withUntrustedContent(jsonResult(await kchat.getChannelHistory(channel_id, { limit, page })), "kchat", ["posts"]);
    },
    kchatHistoryOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_get_thread_replies",
    "Get replies in a kChat message thread",
    {
      thread_id: z.string().describe("Parent post ID"),
    },
    readOnlyTool,
    async ({ thread_id }) => {
      return withUntrustedContent(jsonResult(await kchat.getThreadReplies(thread_id)), "kchat", ["posts"]);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_upload_file",
    "Upload a file to kChat so it can be attached to a post",
    {
      channel_id: z.string().describe("Channel ID that will own the uploaded file"),
      filename: z.string().min(1).describe("Filename to display in kChat"),
      base64_content: z.string().describe("Base64-encoded file content"),
      content_type: z.string().optional().describe("Optional MIME type"),
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: UPLOAD KCHAT FILE TO <channel_id>"),
    },
    mutatingTool,
    async ({ channel_id, filename, base64_content, content_type, confirmation }) => {
      requireExternalConfirmation(options, confirmation, `UPLOAD KCHAT FILE TO ${channel_id}`);
      return jsonResult(await kchat.uploadFile(channel_id, filename, base64_content, content_type));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_search_posts",
    "Search posts across the configured kChat team",
    {
      terms: z.string().min(1).describe("Search terms, including optional from: or in: filters"),
      is_or_search: z.boolean().optional().describe("Use OR matching instead of AND matching"),
      time_zone_offset: z.number().int().optional().describe("Timezone offset used for date searches"),
      include_deleted_channels: z.boolean().optional().describe("Include archived channels"),
      page: z.number().int().min(0).optional().describe("Result page"),
      per_page: z.number().int().min(1).max(200).optional().describe("Results per page"),
    },
    readOnlyTool,
    async ({ terms, is_or_search, time_zone_offset, include_deleted_channels, page, per_page }) => {
      return withUntrustedContent(jsonResult(await kchat.searchPosts({
        terms,
        isOrSearch: is_or_search,
        timeZoneOffset: time_zone_offset,
        includeDeletedChannels: include_deleted_channels,
        page,
        perPage: per_page,
      })), "kchat", ["posts"]);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_get_users",
    "List kChat users in the configured team",
    listSchema,
    readOnlyTool,
    async ({ limit, page }) => {
      return jsonResult(await kchat.getUsers({ limit, page }));
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_get_user_profile",
    "Get a kChat user's profile by user ID",
    {
      user_id: z.string().describe("User ID"),
    },
    readOnlyTool,
    async ({ user_id }) => {
      return jsonResult(await kchat.getUserProfile(user_id));
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kchat_send_direct_message",
    "Send a direct kChat message to a user by username",
    {
      username: z.string().describe("Recipient username"),
      text: z.string().describe("Message text"),
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: SEND KCHAT DM TO <username>"),
    },
    mutatingTool,
    async ({ username, text, confirmation }) => {
      requireExternalConfirmation(options, confirmation, `SEND KCHAT DM TO ${username}`);
      return jsonResult(await kchat.sendDirectMessage(username, text));
    },
    objectOutputSchema
  );
}

const listSchema = {
  limit: z.number().optional().describe("Maximum number of results"),
  page: z.number().optional().describe("Pagination page"),
};
