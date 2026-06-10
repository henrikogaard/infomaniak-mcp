import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KMeetService } from "../services/kmeet.js";
import { jsonResult } from "../tool-handler.js";
import { mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool } from "./register.js";

export function registerKMeetTools(server: McpServer, kmeet: KMeetService) {
  registerStructuredTool(
    server,
    "kmeet_create_room",
    "Create an instant kMeet video conference room. Returns a join URL that can be shared immediately. No account or calendar needed — rooms are ephemeral (Jitsi-based).",
    {
      name: z
        .string()
        .optional()
        .describe("Optional room name (alphanumeric). Random if omitted."),
    },
    mutatingTool,
    async ({ name }) => {
      const room = kmeet.createInstantRoom(name);
      return jsonResult(room);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kmeet_schedule_room",
    "Schedule a kMeet video conference and create a calendar event. Requires a calendar ID.",
    {
      calendar_id: z.number().describe("Infomaniak calendar ID to attach the event to"),
      title: z.string().describe("Meeting title"),
      starting_at: z.string().describe("Start time (YYYY-MM-DD HH:mm:ss)"),
      ending_at: z.string().describe("End time (YYYY-MM-DD HH:mm:ss)"),
      timezone: z
        .string()
        .optional()
        .describe("Timezone (default: Europe/Zurich)"),
      description: z.string().optional().describe("Meeting description"),
      attendees: z
        .array(
          z.object({
            address: z.string().describe("Email address"),
            name: z.string().optional().describe("Display name"),
          })
        )
        .optional()
        .describe("List of attendees to invite"),
      room_options: z
        .object({
          subject: z.string().optional().describe("Displayed meeting subject inside the room"),
          start_audio_muted: z.boolean().optional().describe("Mute participants when they join"),
          enable_recording: z.boolean().optional().describe("Allow cloud recording if the backend supports it"),
          enable_moderator_video: z.boolean().optional().describe("Keep moderator video enabled"),
          start_audio_only: z.boolean().optional().describe("Start the room in audio-only mode"),
          lobby_enabled: z.boolean().optional().describe("Enable waiting room / lobby"),
          password_enabled: z.boolean().optional().describe("Require a password for the room"),
          password: z.string().optional().describe("Room password when password protection is enabled"),
          e2ee_enabled: z.boolean().optional().describe("Request end-to-end encryption support"),
        })
        .optional()
        .describe("Advanced kMeet room options"),
    },
    mutatingTool,
    async ({
      calendar_id,
      title,
      starting_at,
      ending_at,
      timezone,
      description,
      attendees,
      room_options,
    }) => {
      const room = await kmeet.createScheduledRoom({
        calendarId: calendar_id,
        title,
        startingAt: starting_at,
        endingAt: ending_at,
        timezone,
        description,
        attendees,
        options: room_options,
      });
      return jsonResult(room);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "kmeet_get_room_settings",
    "Get settings for an existing scheduled kMeet room, such as lobby/password/recording flags returned by the API.",
    {
      room_id: z.string().describe("kMeet room ID"),
    },
    readOnlyTool,
    async ({ room_id }) => {
      return jsonResult(await kmeet.getRoomSettings(room_id));
    },
    objectOutputSchema
  );
}
