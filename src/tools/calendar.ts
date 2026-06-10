import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalendarService } from "../services/calendar.js";
import { textResult, jsonResult, withUntrustedContent } from "../tool-handler.js";
import { arrayOutputSchema, destructiveTool, mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool, requireConfirmation, textOutputSchema } from "./register.js";

const calendarEventArrayOutputSchema = {
  data: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
  }).passthrough()),
};

export function registerCalendarTools(server: McpServer, calendar: CalendarService) {
  registerStructuredTool(
    server,
    "calendar_list_calendars",
    "List all available calendars",
    {},
    readOnlyTool,
    async () => {
      const calendars = await calendar.listCalendars();
      return jsonResult(calendars);
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "calendar_list_events",
    "List calendar events in a date range. Dates should be ISO 8601 format.",
    {
      from: z.string().describe("Start date/time (ISO 8601, e.g. 2025-01-15T09:00:00)"),
      to: z.string().describe("End date/time (ISO 8601, e.g. 2025-01-15T18:00:00)"),
      calendar_id: z.string().optional().describe("Calendar ID (omit for all calendars)"),
    },
    readOnlyTool,
    async ({ from, to, calendar_id }) => {
      const events = await calendar.listEvents(from, to, calendar_id);
      return withUntrustedContent(jsonResult(events), "calendar", ["title", "description", "location", "attendees"]);
    },
    calendarEventArrayOutputSchema
  );

  registerStructuredTool(
    server,
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
      rrule: z.string().optional().describe("Optional iCalendar recurrence rule, e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR or RRULE:FREQ=DAILY;COUNT=5"),
      reminder_minutes: z.array(z.number().int().min(0)).optional().describe("Optional reminder offsets in minutes before the event, e.g. [10, 60]"),
    },
    mutatingTool,
    async ({ title, start, end, description, calendar_id, attendees, full_day, rrule, reminder_minutes }) => {
      const event = await calendar.createEvent({
        title, start, end, description,
        calendarId: calendar_id,
        attendees,
        fullDay: full_day,
        recurrenceRule: rrule,
        reminderMinutes: reminder_minutes,
      });
      return jsonResult(event);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "calendar_update_event",
    "Update an existing calendar event. Only provided fields will be changed.",
    {
      event_id: z.string().describe("Event ID to update"),
      title: z.string().optional().describe("New title"),
      start: z.string().optional().describe("New start date/time (ISO 8601)"),
      end: z.string().optional().describe("New end date/time (ISO 8601)"),
      description: z.string().optional().describe("New description"),
      rrule: z.string().optional().describe("New iCalendar recurrence rule, e.g. FREQ=WEEKLY;BYDAY=MO. Omit to preserve the current rule."),
      clear_recurrence: z.boolean().optional().describe("Set true to remove the existing recurrence rule."),
      reminder_minutes: z.array(z.number().int().min(0)).optional().describe("Replace reminder offsets in minutes before the event, e.g. [15]. Omit to preserve current reminders."),
      clear_reminders: z.boolean().optional().describe("Set true to remove reminders from the event."),
    },
    mutatingTool,
    async ({ event_id, title, start, end, description, rrule, clear_recurrence, reminder_minutes, clear_reminders }) => {
      const event = await calendar.updateEvent(event_id, {
        title,
        start,
        end,
        description,
        recurrenceRule: rrule,
        clearRecurrence: clear_recurrence,
        reminderMinutes: reminder_minutes,
        clearReminders: clear_reminders,
      });
      return jsonResult(event);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "calendar_delete_event",
    "Delete a calendar event. Requires exact confirmation: DELETE EVENT <event_id>.",
    {
      event_id: z.string().describe("Event ID to delete"),
      confirmation: z.string().describe("Exact confirmation phrase, e.g. DELETE EVENT 123"),
    },
    destructiveTool,
    async ({ event_id, confirmation }) => {
      requireConfirmation(confirmation, `DELETE EVENT ${event_id}`);
      await calendar.deleteEvent(event_id);
      return textResult(`Deleted event ${event_id}`);
    },
    textOutputSchema
  );
}
