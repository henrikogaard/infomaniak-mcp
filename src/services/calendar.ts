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
    if (params.title) body.title = params.title;
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

function formatDateForApi(dateStr: string): string {
  // Accept ISO 8601 and convert to "YYYY-MM-DD HH:mm" format
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${mins}`;
}
