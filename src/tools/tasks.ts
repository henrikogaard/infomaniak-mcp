import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalDAVTasksService } from "../services/caldav-tasks.js";
import { jsonResult, structuredResult } from "../tool-handler.js";
import { arrayOutputSchema, destructiveTool, mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool, requireConfirmation } from "./register.js";

const statusFilterSchema = z.enum(["all", "open", "completed"]);
const taskStatusSchema = z.enum(["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"]);
const prioritySchema = z.number().int().min(0).max(9);
const taskSummaryArrayOutputSchema = {
  data: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string().optional(),
  }).passthrough()),
};

export function registerTaskTools(server: McpServer, tasks: CalDAVTasksService) {
  registerStructuredTool(
    server,
    "tasks_list_calendars",
    "List CalDAV calendars that can contain tasks (VTODO items)",
    {},
    readOnlyTool,
    async () => {
      const calendars = await tasks.listCalendars();
      return jsonResult(calendars);
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "tasks_list",
    "List CalDAV tasks. Returns task id, title, due date, status, completion state, calendar, and metadata.",
    {
      calendar_url: z.string().optional().describe("Calendar URL to limit results to"),
      status: statusFilterSchema.optional().describe("Filter tasks by completion state (default: all)"),
      limit: z.number().int().positive().optional().describe("Maximum number of tasks to return"),
    },
    readOnlyTool,
    async ({ calendar_url, status, limit }) => {
      const result = await tasks.listTasks({
        calendarUrl: calendar_url,
        status: status ?? "all",
        limit,
      });
      return jsonResult(result);
    },
    taskSummaryArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "tasks_search",
    "Search CalDAV tasks by title, description, status, calendar name, or category.",
    {
      query: z.string().describe("Search query"),
      calendar_url: z.string().optional().describe("Calendar URL to limit results to"),
      status: statusFilterSchema.optional().describe("Filter tasks by completion state (default: all)"),
      limit: z.number().int().positive().optional().describe("Maximum number of tasks to return"),
    },
    readOnlyTool,
    async ({ query, calendar_url, status, limit }) => {
      const result = await tasks.listTasks({
        query,
        calendarUrl: calendar_url,
        status: status ?? "all",
        limit,
      });
      return jsonResult(result);
    },
    taskSummaryArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "tasks_get",
    "View one CalDAV task by task id, UID, or object URL.",
    {
      task_id: z.string().describe("Task id, UID, or CalDAV object URL returned by tasks_list/tasks_search"),
      calendar_url: z.string().optional().describe("Calendar URL to limit lookup to"),
    },
    readOnlyTool,
    async ({ task_id, calendar_url }) => {
      const task = await tasks.getTask(task_id, calendar_url);
      return jsonResult(task);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "tasks_create",
    "Create a CalDAV task (VTODO).",
    {
      title: z.string().describe("Task title"),
      description: z.string().optional().describe("Optional task description"),
      due: z.string().optional().describe("Optional due date/time (ISO 8601 or YYYY-MM-DD)"),
      priority: prioritySchema.optional().describe("Optional iCalendar priority from 0-9, where 1 is highest and 9 is lowest"),
      categories: z.array(z.string()).optional().describe("Optional task categories/tags"),
      calendar_url: z.string().optional().describe("CalDAV calendar URL (uses the first task-capable calendar if omitted)"),
    },
    mutatingTool,
    async ({ title, description, due, priority, categories, calendar_url }) => {
      const task = await tasks.createTask({
        title,
        description,
        due,
        priority,
        categories,
        calendarUrl: calendar_url,
      });
      return jsonResult(task);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "tasks_update",
    "Update a CalDAV task. Only provided fields are changed. Pass null for due or priority to remove them.",
    {
      task_id: z.string().describe("Task id, UID, or CalDAV object URL returned by tasks_list/tasks_search"),
      calendar_url: z.string().optional().describe("Calendar URL to limit lookup to"),
      title: z.string().optional().describe("New task title"),
      description: z.string().optional().describe("New task description. Use an empty string to remove it."),
      due: z.string().nullable().optional().describe("New due date/time (ISO 8601 or YYYY-MM-DD), or null to remove"),
      priority: prioritySchema.nullable().optional().describe("New iCalendar priority from 0-9, or null to remove"),
      categories: z.array(z.string()).optional().describe("Replacement categories/tags. Use an empty array to remove all categories."),
      status: taskStatusSchema.optional().describe("Replacement iCalendar task status"),
    },
    mutatingTool,
    async ({ task_id, calendar_url, title, description, due, priority, categories, status }) => {
      const task = await tasks.updateTask(task_id, {
        title,
        description,
        due,
        priority,
        categories,
        status,
      }, calendar_url);
      return jsonResult(task);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "tasks_complete",
    "Mark a CalDAV task completed or reopen it.",
    {
      task_id: z.string().describe("Task id, UID, or CalDAV object URL returned by tasks_list/tasks_search"),
      completed: z.boolean().optional().describe("Set true to complete, false to reopen (default: true)"),
      calendar_url: z.string().optional().describe("Calendar URL to limit lookup to"),
    },
    mutatingTool,
    async ({ task_id, completed, calendar_url }) => {
      const task = await tasks.setTaskCompleted(task_id, completed ?? true, calendar_url);
      return jsonResult(task);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "tasks_delete",
    "Delete a CalDAV task. Requires exact confirmation: DELETE TASK <task_id>.",
    {
      task_id: z.string().describe("Task id, UID, or CalDAV object URL returned by tasks_list/tasks_search"),
      calendar_url: z.string().optional().describe("Calendar URL to limit lookup to"),
      confirmation: z.string().describe("Exact confirmation phrase, e.g. DELETE TASK task-123"),
    },
    destructiveTool,
    async ({ task_id, calendar_url, confirmation }) => {
      requireConfirmation(confirmation, `DELETE TASK ${task_id}`);
      await tasks.deleteTask(task_id, calendar_url);
      return structuredResult({ taskId: task_id }, `Deleted task ${task_id}`);
    },
    { taskId: z.string() }
  );
}
