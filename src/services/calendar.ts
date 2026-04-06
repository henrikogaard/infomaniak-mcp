import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse {
  data?: unknown;
}

interface Calendar {
  id: string;
  name: string;
  color?: string;
  [key: string]: unknown;
}

interface CalendarEvent {
  id: string;
  uid?: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: Attendee[];
  [key: string]: unknown;
}

interface Attendee {
  address: string;
  name?: string;
  state?: string;
  organizer?: boolean;
  className?: string;
}

export class CalendarService {
  private api: InfomaniakAPI;
  private timezone: string | null = null;
  private userEmail: string | null = null;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
  }

  private async getUserProfile(): Promise<{ timezone: string; email: string }> {
    if (this.timezone && this.userEmail) {
      return { timezone: this.timezone, email: this.userEmail };
    }
    const res = (await this.api.get("/2/profile")) as ApiResponse;
    const profile = res.data as Record<string, unknown>;
    this.timezone = (profile.timezone as string) ?? "Europe/Zurich";
    this.userEmail = (profile.email as string) ?? "";
    return { timezone: this.timezone, email: this.userEmail };
  }

  async listCalendars(): Promise<Calendar[]> {
    const res = (await this.api.get(
      "/1/calendar/pim/calendar"
    )) as ApiResponse;
    return (res.data ?? []) as Calendar[];
  }

  async listEvents(from: string, to: string, calendarId?: string): Promise<CalendarEvent[]> {
    const calendars = calendarId
      ? [{ id: calendarId }]
      : await this.listCalendars();

    const allEvents: CalendarEvent[] = [];
    for (const cal of calendars) {
      const res = (await this.api.get("/1/calendar/pim/event", {
        calendar_id: String(cal.id),
        from: formatDateForApi(from),
        to: formatDateForApi(to),
      })) as ApiResponse;
      const events = (res.data ?? []) as CalendarEvent[];
      allEvents.push(...events);
    }
    return allEvents;
  }

  async createEvent(params: {
    title: string;
    start: string;
    end: string;
    description?: string;
    calendarId?: string;
    attendees?: string[];
    fullDay?: boolean;
  }): Promise<CalendarEvent> {
    const { timezone, email } = await this.getUserProfile();
    const calendars = await this.listCalendars();
    const calendarId = params.calendarId ?? String(calendars[0]?.id);

    const attendeeList: Attendee[] = [
      { address: email, className: "Organizer", name: email, organizer: true, state: "ACCEPTED" },
    ];
    if (params.attendees) {
      for (const addr of params.attendees) {
        attendeeList.push({
          address: addr,
          className: "Attendee",
          name: addr,
          organizer: false,
          state: "NEEDS-ACTION",
        });
      }
    }

    const body = {
      title: params.title,
      start: formatDateForApi(params.start),
      end: formatDateForApi(params.end),
      description: params.description ?? "",
      freebusy: "busy",
      type: "event",
      calendar_id: calendarId,
      fullday: params.fullDay ?? false,
      timezone_start: timezone,
      timezone_end: timezone,
      attendees: attendeeList,
    };

    const res = (await this.api.post("/1/calendar/pim/event", body)) as ApiResponse;
    return res.data as CalendarEvent;
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.api.delete(`/1/calendar/pim/event/${eventId}`);
  }

  async updateEvent(eventId: string, params: {
    title?: string;
    start?: string;
    end?: string;
    description?: string;
  }): Promise<CalendarEvent> {
    const { timezone } = await this.getUserProfile();
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.start) {
      body.start = formatDateForApi(params.start);
      body.timezone_start = timezone;
    }
    if (params.end) {
      body.end = formatDateForApi(params.end);
      body.timezone_end = timezone;
    }
    if (params.description !== undefined) body.description = params.description;

    const res = (await this.api.put(`/1/calendar/pim/event/${eventId}`, body)) as ApiResponse;
    return res.data as CalendarEvent;
  }
}

/**
 * Format a date string for the Infomaniak Calendar API.
 * Accepts ISO 8601 or "YYYY-MM-DD HH:mm" format.
 * Returns "YYYY-MM-DD HH:mm" format.
 *
 * Uses regex parsing to avoid timezone conversion issues
 * (Date constructor would convert to local timezone).
 */
function formatDateForApi(dateStr: string): string {
  // If already in "YYYY-MM-DD HH:mm" format, pass through
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try ISO 8601 regex: "2025-01-15T09:00:00", "2025-01-15T09:00:00Z", "2025-01-15T09:00:00+02:00"
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]} ${isoMatch[4]}:${isoMatch[5]}`;
  }

  // Date-only: "2025-01-15" → midnight
  const dateOnlyMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]} 00:00`;
  }

  // Last resort: pass through and let the API handle it
  return dateStr;
}
