import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalendarService } from "../services/calendar.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerCalendarTools(server: McpServer, calendar: CalendarService) {
  server.tool(
    "calendar_list_calendars",
    "List all available calendars",
    {},
    safeHandler(async () => {
      const calendars = await calendar.listCalendars();
      return jsonResult(calendars);
    })
  );

  server.tool(
    "calendar_list_events",
    "List calendar events in a date range. Dates should be ISO 8601 format.",
    {
      from: z.string().describe("Start date/time (ISO 8601, e.g. 2025-01-15T09:00:00)"),
      to: z.string().describe("End date/time (ISO 8601, e.g. 2025-01-15T18:00:00)"),
      calendar_id: z.string().optional().describe("Calendar ID (omit for all calendars)"),
    },
    safeHandler(async ({ from, to, calendar_id }) => {
      const events = await calendar.listEvents(from, to, calendar_id);
      return jsonResult(events);
    })
  );

  server.tool(
    "calendar_create_event",
    "Create a new calendar event",
    {
      title: z.string().describe("Event title"),
      start: z.string().describe("Start date/time (ISO 8601)"),
      end: z.string().describe("End date/time (ISO 8601)"),
      description: z.string().optional().describe("Event description"),
      calendar_id: z.string().optional().describe("Calendar ID (uses default if omitted)"),
      attendees: z.array(z.string()).optional().describe("List of attendee email addresses"),
      full_day: z.boolean().optional().describe("Is this a full-day event?"),
    },
    safeHandler(async ({ title, start, end, description, calendar_id, attendees, full_day }) => {
      const event = await calendar.createEvent({
        title, start, end, description,
        calendarId: calendar_id,
        attendees,
        fullDay: full_day,
      });
      return jsonResult(event);
    })
  );

  server.tool(
    "calendar_update_event",
    "Update an existing calendar event. Only provided fields will be changed.",
    {
      event_id: z.string().describe("Event ID to update"),
      title: z.string().optional().describe("New title"),
      start: z.string().optional().describe("New start date/time (ISO 8601)"),
      end: z.string().optional().describe("New end date/time (ISO 8601)"),
      description: z.string().optional().describe("New description"),
    },
    safeHandler(async ({ event_id, title, start, end, description }) => {
      const event = await calendar.updateEvent(event_id, { title, start, end, description });
      return jsonResult(event);
    })
  );

  server.tool(
    "calendar_delete_event",
    "Delete a calendar event",
    { event_id: z.string().describe("Event ID to delete") },
    safeHandler(async ({ event_id }) => {
      await calendar.deleteEvent(event_id);
      return textResult(`Deleted event ${event_id}`);
    })
  );
}
