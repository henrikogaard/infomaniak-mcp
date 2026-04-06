import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KMeetService } from "../services/kmeet.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerKMeetTools(server: McpServer, kmeet: KMeetService) {
  server.tool(
    "kmeet_create_room",
    "Create an instant kMeet video conference room. Returns a join URL that can be shared immediately. No account or calendar needed — rooms are ephemeral (Jitsi-based).",
    {
      name: z
        .string()
        .optional()
        .describe("Optional room name (alphanumeric). Random if omitted."),
    },
    safeHandler(async ({ name }) => {
      const room = kmeet.createInstantRoom(name);
      return jsonResult(room);
    })
  );

  server.tool(
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
    },
    safeHandler(
      async ({
        calendar_id,
        title,
        starting_at,
        ending_at,
        timezone,
        description,
        attendees,
      }) => {
        const room = await kmeet.createScheduledRoom({
          calendarId: calendar_id,
          title,
          startingAt: starting_at,
          endingAt: ending_at,
          timezone,
          description,
          attendees,
        });
        return jsonResult(room);
      }
    )
  );
}
