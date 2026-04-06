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
  calendar_id?: string | number;
  uid?: string;
  type?: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  fullday?: boolean;
  timezone_start?: string;
  timezone_end?: string;
  freebusy?: string;
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
    const preferences = profile.preferences as Record<string, unknown> | undefined;
    const timezonePreference = preferences?.timezone as Record<string, unknown> | undefined;
    this.timezone = (timezonePreference?.name as string) ?? "Europe/Zurich";
    this.userEmail = (profile.email as string) ?? "";
    return { timezone: this.timezone, email: this.userEmail };
  }

  async listCalendars(): Promise<Calendar[]> {
    const res = (await this.api.get(
      "/1/calendar/pim/calendar"
    )) as ApiResponse;
    const data = (res.data ?? {}) as { calendars?: Calendar[] };
    return data.calendars ?? [];
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
    const current = await this.findEventById(eventId);

    const body: Record<string, unknown> = {
      title: normalizeString(params.title ?? current.title, current.title, "Untitled"),
      start: formatDateForApi(params.start ?? current.start),
      end: formatDateForApi(params.end ?? current.end),
      description: normalizeString(params.description ?? current.description, "", ""),
      type: normalizeString(current.type, "event", "event"),
      fullday: current.fullday ?? false,
      timezone_start: normalizeString(current.timezone_start, timezone, timezone),
      timezone_end: normalizeString(current.timezone_end, timezone, timezone),
    };

    const freebusy = normalizeOptionalString(current.freebusy);
    if (freebusy !== undefined) body.freebusy = freebusy;

    const res = (await this.api.put(`/1/calendar/pim/event/${eventId}`, body)) as ApiResponse;
    return res.data as CalendarEvent;
  }

  private async findEventById(eventId: string): Promise<CalendarEvent> {
    const calendars = await this.listCalendars();
    const now = new Date();

    for (let step = 0; step <= 24; step += 1) {
      const candidateStarts = step === 0
        ? [addMonths(now, -1)]
        : [addMonths(now, -1 - step * 3), addMonths(now, -1 + step * 3)];

      for (const windowStart of candidateStarts) {
        const windowEnd = addMonths(windowStart, 3);
        for (const calendar of calendars) {
          const res = (await this.api.get("/1/calendar/pim/event", {
            calendar_id: String(calendar.id),
            from: formatDateForApi(windowStart.toISOString()),
            to: formatDateForApi(windowEnd.toISOString()),
          })) as ApiResponse;
          const events = (res.data ?? []) as CalendarEvent[];
          const event = events.find((entry) => String(entry.id) === eventId);
          if (event) {
            return event;
          }
        }
      }
    }

    throw new Error(`Event ${eventId} not found`);
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
  // If already in "YYYY-MM-DD HH:mm:ss" format, pass through
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Accept "YYYY-MM-DD HH:mm" and add seconds
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dateStr)) {
    return `${dateStr}:00`;
  }

  // Try ISO 8601 regex: "2025-01-15T09:00:00", "2025-01-15T09:00:00Z", "2025-01-15T09:00:00+02:00"
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]} ${isoMatch[4]}:${isoMatch[5]}:${isoMatch[6] ?? "00"}`;
  }

  // Date-only: "2025-01-15" → midnight
  const dateOnlyMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]} 00:00:00`;
  }

  // Last resort: pass through and let the API handle it
  return dateStr;
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return undefined;
  }
  return String(value);
}

function normalizeString(value: unknown, fallback: string, defaultValue: string): string {
  const normalized = normalizeOptionalString(value);
  if (normalized !== undefined) {
    return normalized;
  }
  if (fallback.length > 0) {
    return fallback;
  }
  return defaultValue;
}
