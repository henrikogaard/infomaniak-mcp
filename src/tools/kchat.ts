import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KChatService } from "../services/kchat.js";
import { safeHandler, jsonResult } from "../tool-handler.js";

export function registerKChatTools(server: McpServer, kchat: KChatService) {
  server.tool(
    "kchat_list_channels",
    "List public kChat channels for the configured team",
    listSchema,
    safeHandler(async ({ limit, page }) => {
      return jsonResult(await kchat.listChannels({ limit, page }));
    })
  );

  server.tool(
    "kchat_post_message",
    "Post a new message to a kChat channel",
    {
      channel_id: z.string().describe("kChat channel ID"),
      text: z.string().describe("Message text"),
    },
    safeHandler(async ({ channel_id, text }) => {
      return jsonResult(await kchat.postMessage(channel_id, text));
    })
  );

  server.tool(
    "kchat_reply_to_thread",
    "Reply to a kChat message thread",
    {
      thread_id: z.string().describe("Parent post ID"),
      text: z.string().describe("Reply text"),
    },
    safeHandler(async ({ thread_id, text }) => {
      return jsonResult(await kchat.replyToThread(thread_id, text));
    })
  );

  server.tool(
    "kchat_add_reaction",
    "Add an emoji reaction to a kChat message",
    {
      post_id: z.string().describe("Post ID"),
      emoji_name: z.string().describe("Emoji name without surrounding colons"),
    },
    safeHandler(async ({ post_id, emoji_name }) => {
      return jsonResult(await kchat.addReaction(post_id, emoji_name));
    })
  );

  server.tool(
    "kchat_get_channel_history",
    "Get recent posts from a kChat channel",
    {
      channel_id: z.string().describe("Channel ID"),
      limit: z.number().optional().describe("Maximum number of posts to return"),
      page: z.number().optional().describe("Pagination page"),
    },
    safeHandler(async ({ channel_id, limit, page }) => {
      return jsonResult(await kchat.getChannelHistory(channel_id, { limit, page }));
    })
  );

  server.tool(
    "kchat_get_thread_replies",
    "Get replies in a kChat message thread",
    {
      thread_id: z.string().describe("Parent post ID"),
    },
    safeHandler(async ({ thread_id }) => {
      return jsonResult(await kchat.getThreadReplies(thread_id));
    })
  );

  server.tool(
    "kchat_get_users",
    "List kChat users in the configured team",
    listSchema,
    safeHandler(async ({ limit, page }) => {
      return jsonResult(await kchat.getUsers({ limit, page }));
    })
  );

  server.tool(
    "kchat_get_user_profile",
    "Get a kChat user's profile by user ID",
    {
      user_id: z.string().describe("User ID"),
    },
    safeHandler(async ({ user_id }) => {
      return jsonResult(await kchat.getUserProfile(user_id));
    })
  );

  server.tool(
    "kchat_send_direct_message",
    "Send a direct kChat message to a user by username",
    {
      username: z.string().describe("Recipient username"),
      text: z.string().describe("Message text"),
    },
    safeHandler(async ({ username, text }) => {
      return jsonResult(await kchat.sendDirectMessage(username, text));
    })
  );
}

const listSchema = {
  limit: z.number().optional().describe("Maximum number of results"),
  page: z.number().optional().describe("Pagination page"),
};
