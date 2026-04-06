import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KMeetService } from "../services/kmeet.js";

export function registerKMeetTools(server: McpServer, kmeet: KMeetService) {
  server.tool(
    "kmeet_create_room",
    "Create a kMeet video conference room. Returns a join URL.",
    {
      name: z.string().optional().describe("Room name"),
    },
    async ({ name }) => {
      const room = await kmeet.createRoom({ name });
      return { content: [{ type: "text", text: JSON.stringify(room, null, 2) }] };
    }
  );

  server.tool(
    "kmeet_list_rooms",
    "List all kMeet video conference rooms",
    {},
    async () => {
      const rooms = await kmeet.listRooms();
      return { content: [{ type: "text", text: JSON.stringify(rooms, null, 2) }] };
    }
  );

  server.tool(
    "kmeet_delete_room",
    "Delete a kMeet video conference room",
    { room_id: z.string().describe("Room ID to delete") },
    async ({ room_id }) => {
      await kmeet.deleteRoom(room_id);
      return { content: [{ type: "text", text: `Deleted room ${room_id}` }] };
    }
  );
}
