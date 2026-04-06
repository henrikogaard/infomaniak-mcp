import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse {
  data?: unknown;
}

interface MeetingRoom {
  id: string;
  name: string;
  url: string;
  [key: string]: unknown;
}

export class KMeetService {
  private api: InfomaniakAPI;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
  }

  async createRoom(params: {
    name?: string;
  }): Promise<MeetingRoom> {
    const body: Record<string, unknown> = {};
    if (params.name) body.name = params.name;

    const res = (await this.api.post("/1/meet/room", body)) as ApiResponse;
    return res.data as MeetingRoom;
  }

  async listRooms(): Promise<MeetingRoom[]> {
    const res = (await this.api.get("/1/meet/room")) as ApiResponse;
    return (res.data ?? []) as MeetingRoom[];
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.api.delete(`/1/meet/room/${roomId}`);
  }
}
