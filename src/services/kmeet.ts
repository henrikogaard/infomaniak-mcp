import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";
import { randomBytes } from "node:crypto";

interface ScheduledRoom {
  id: string;
  name: string;
  code: string;
  hostname: string;
  url: string;
  [key: string]: unknown;
}

interface RoomOptions {
  subject?: string;
  start_audio_muted?: boolean;
  enable_recording?: boolean;
  enable_moderator_video?: boolean;
  start_audio_only?: boolean;
  lobby_enabled?: boolean;
  password_enabled?: boolean;
  password?: string;
  e2ee_enabled?: boolean;
}

export class KMeetService {
  private api: InfomaniakAPI;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
  }

  /**
   * Generate an instant kMeet room URL (no API call needed — kMeet is Jitsi-based).
   * The room exists as long as someone is in it.
   */
  createInstantRoom(name?: string): { url: string; roomName: string } {
    // Generate a random 16-char alphanumeric room ID (same as the official kMeet apps)
    const roomName =
      name?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) ||
      randomBytes(8).toString("hex");
    return {
      url: `https://kmeet.infomaniak.com/${roomName}`,
      roomName,
    };
  }

  /**
   * Create a scheduled kMeet conference room via the API.
   * Requires a calendar_id to attach the event to.
   */
  async createScheduledRoom(params: {
    calendarId: number;
    title: string;
    startingAt: string;
    endingAt: string;
    timezone?: string;
    description?: string;
    attendees?: Array<{ address: string; name?: string }>;
    options?: RoomOptions;
  }): Promise<ScheduledRoom> {
    const options = {
      subject: params.options?.subject ?? params.title,
      start_audio_muted: params.options?.start_audio_muted ?? false,
      enable_recording: params.options?.enable_recording ?? false,
      enable_moderator_video: params.options?.enable_moderator_video ?? true,
      start_audio_only: params.options?.start_audio_only ?? false,
      lobby_enabled: params.options?.lobby_enabled ?? false,
      password_enabled: params.options?.password_enabled ?? Boolean(params.options?.password),
      e2ee_enabled: params.options?.e2ee_enabled ?? false,
      ...(params.options?.password ? { password: params.options.password } : {}),
    };

    const body: Record<string, unknown> = {
      calendar_id: params.calendarId,
      starting_at: params.startingAt,
      ending_at: params.endingAt,
      timezone: params.timezone ?? "Europe/Zurich",
      hostname: "kmeet.infomaniak.com",
      title: params.title,
      options,
    };
    if (params.description) body.description = params.description;
    if (params.attendees) {
      body.attendees = params.attendees.map((a) => ({
        address: a.address,
        name: a.name ?? "",
        state: "NEEDS-ACTION",
        organizer: false,
      }));
    }

    const res = (await this.api.post("/1/kmeet/rooms", body)) as {
      data?: unknown;
    };
    const data = res.data as Record<string, unknown>;
    return {
      ...data,
      url: `https://kmeet.infomaniak.com/${data.code ?? data.id}`,
    } as ScheduledRoom;
  }
}
