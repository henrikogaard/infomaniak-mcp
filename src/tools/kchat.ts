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
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: POST KCHAT MESSAGE TO <channel_id>"),
    },
    mutatingTool,
    async ({ channel_id, text, confirmation }) => {
      requireExternalConfirmation(options, confirmation, `POST KCHAT MESSAGE TO ${channel_id}`);
      return jsonResult(await kchat.postMessage(channel_id, text));
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
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: REPLY KCHAT THREAD <thread_id>"),
    },
    mutatingTool,
    async ({ thread_id, text, confirmation }) => {
      requireExternalConfirmation(options, confirmation, `REPLY KCHAT THREAD ${thread_id}`);
      return jsonResult(await kchat.replyToThread(thread_id, text));
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
