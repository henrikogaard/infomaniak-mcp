import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KMeetService } from "../services/kmeet.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerKMeetTools(server: McpServer, kmeet: KMeetService) {
  server.tool(
    "kmeet_create_room",
    "Create a kMeet video conference room. Returns a join URL that can be shared with participants.",
    {
      name: z.string().optional().describe("Room name"),
    },
    safeHandler(async ({ name }) => {
      const room = await kmeet.createRoom({ name });
      return jsonResult(room);
    })
  );

  server.tool(
    "kmeet_list_rooms",
    "List all kMeet video conference rooms",
    {},
    safeHandler(async () => {
      const rooms = await kmeet.listRooms();
      return jsonResult(rooms);
    })
  );

  server.tool(
    "kmeet_delete_room",
    "Delete a kMeet video conference room",
    { room_id: z.string().describe("Room ID to delete") },
    safeHandler(async ({ room_id }) => {
      await kmeet.deleteRoom(room_id);
      return textResult(`Deleted room ${room_id}`);
    })
  );
}
