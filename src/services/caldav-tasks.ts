import ICAL from "ical.js";
import { DAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import type { Config } from "../config.js";

export interface CalDAVTask {
  id: string;
  uid: string;
  url: string;
  etag?: string;
  calendarUrl: string;
  calendarName: string;
  title: string;
  description?: string;
  status?: string;
  completed: boolean;
  priority?: number;
  due?: string;
  created?: string;
  lastModified?: string;
  categories: string[];
  percentComplete?: number;
  completedAt?: string;
}

interface TaskSource {
  url: string;
  etag?: string;
  calendarUrl: string;
  calendarName: string;
}

export interface TaskListOptions {
  calendarUrl?: string;
  query?: string;
  status?: "all" | "open" | "completed";
  limit?: number;
}

export interface CreateTaskParams {
  title: string;
  description?: string;
  due?: string;
  priority?: number;
  categories?: string[];
  calendarUrl?: string;
}

export interface UpdateTaskParams {
  title?: string;
  description?: string;
  due?: string | null;
  priority?: number | null;
  categories?: string[];
  completed?: boolean;
  status?: string;
}

export interface BuildTaskICalendarParams {
  uid?: string;
  title: string;
  description?: string;
  due?: string;
  priority?: number;
  categories?: string[];
  now?: Date;
}

export interface UpdateTaskICalendarParams extends UpdateTaskParams {
  uid?: string;
  now?: Date;
}

const VTODO_FILTERS = [
  {
    "comp-filter": {
      _attributes: { name: "VCALENDAR" },
      "comp-filter": {
        _attributes: { name: "VTODO" },
      },
    },
  },
];

export class CalDAVTasksService {
  private config: Config;
  private client: DAVClient | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  private async getClient(): Promise<DAVClient> {
    if (this.client) {
      try {
        await this.client.fetchCalendars();
        return this.client;
      } catch {
        this.client = null;
      }
    }

    console.error(`[CalDAV] Connecting to ${this.config.calDavUrl} as ${this.config.davUser}`);

    const client = new DAVClient({
      serverUrl: this.config.calDavUrl,
      credentials: {
        username: this.config.davUser,
        password: this.config.davPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });

    try {
      await client.login();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CalDAV] Login failed: ${msg}`);

      if (msg.includes("homeUrl")) {
        console.error("[CalDAV] Retrying with /.well-known/caldav appended to serverUrl");
        const fallbackClient = new DAVClient({
          serverUrl: `${this.config.calDavUrl.replace(/\/+$/, "")}/.well-known/caldav`,
          credentials: {
            username: this.config.davUser,
            password: this.config.davPassword,
          },
          authMethod: "Basic",
          defaultAccountType: "caldav",
        });
        await fallbackClient.login();
        this.client = fallbackClient;
        console.error("[CalDAV] Connected (via .well-known fallback)");
        return this.client;
      }
      throw err;
    }

    this.client = client;
    console.error("[CalDAV] Connected successfully");
    return this.client;
  }

  async listCalendars(): Promise<Array<{ url: string; displayName: string; components?: string[] }>> {
    const client = await this.getClient();
    const calendars = await this.fetchTaskCalendars(client);
    return calendars.map((calendar) => ({
      url: calendar.url,
      displayName: normalizeDisplayName(calendar.displayName, calendar.url),
      components: calendar.components,
    }));
  }

  async listTasks(options: TaskListOptions = {}): Promise<CalDAVTask[]> {
    const client = await this.getClient();
    const calendars = await this.fetchTaskCalendars(client);
    const targetCalendars = options.calendarUrl
      ? calendars.filter((calendar) => calendar.url === options.calendarUrl)
      : calendars;

    const taskGroups = await Promise.all(
      targetCalendars.map(async (calendar) => this.fetchCalendarTasks(client, calendar))
    );

    let tasks = taskGroups.flat();
    tasks = filterTasks(tasks, options);
    tasks.sort(compareTasks);

    if (options.limit && options.limit > 0) {
      return tasks.slice(0, options.limit);
    }
    return tasks;
  }

  async getTask(taskId: string, calendarUrl?: string): Promise<CalDAVTask> {
    const tasks = await this.listTasks({ calendarUrl, status: "all" });
    const task = tasks.find((candidate) =>
      candidate.id === taskId || candidate.uid === taskId || candidate.url === taskId
    );

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  async createTask(params: CreateTaskParams): Promise<CalDAVTask> {
    const client = await this.getClient();
    const calendar = await this.getWritableCalendar(client, params.calendarUrl);
    const uid = crypto.randomUUID();
    const filename = `${uid}.ics`;
    const iCalString = buildTaskICalendar({ ...params, uid });

    await client.createCalendarObject({
      calendar,
      filename,
      iCalString,
    });

    return parseTasksFromICalendar(iCalString, {
      url: new URL(filename, calendar.url).href,
      calendarUrl: calendar.url,
      calendarName: normalizeDisplayName(calendar.displayName, calendar.url),
    })[0];
  }

  async updateTask(taskId: string, params: UpdateTaskParams, calendarUrl?: string): Promise<CalDAVTask> {
    const client = await this.getClient();
    const match = await this.findTaskObject(client, taskId, calendarUrl);
    const updatedData = updateTaskICalendar(String(match.object.data ?? ""), {
      ...params,
      uid: match.task.uid,
    });

    await client.updateCalendarObject({
      calendarObject: {
        url: match.object.url,
        etag: match.object.etag,
        data: updatedData,
      },
    });

    return parseTasksFromICalendar(updatedData, {
      url: match.object.url,
      etag: match.object.etag,
      calendarUrl: match.calendar.url,
      calendarName: normalizeDisplayName(match.calendar.displayName, match.calendar.url),
    })[0];
  }

  async setTaskCompleted(taskId: string, completed: boolean, calendarUrl?: string): Promise<CalDAVTask> {
    return this.updateTask(taskId, { completed }, calendarUrl);
  }

  async deleteTask(taskId: string, calendarUrl?: string): Promise<void> {
    const client = await this.getClient();
    const match = await this.findTaskObject(client, taskId, calendarUrl);

    await client.deleteCalendarObject({
      calendarObject: {
        url: match.object.url,
        etag: match.object.etag,
      },
    });
  }

  private async fetchTaskCalendars(client: DAVClient): Promise<DAVCalendar[]> {
    const calendars = await client.fetchCalendars();
    return calendars.filter(calendarSupportsTasks);
  }

  private async fetchCalendarTasks(client: DAVClient, calendar: DAVCalendar): Promise<CalDAVTask[]> {
    const objects = await client.fetchCalendarObjects({
      calendar,
      filters: VTODO_FILTERS,
      urlFilter: () => true,
    });

    const calendarName = normalizeDisplayName(calendar.displayName, calendar.url);
    return objects.flatMap((object) =>
      parseTasksFromICalendar(String(object.data ?? ""), {
        url: object.url,
        etag: object.etag,
        calendarUrl: calendar.url,
        calendarName,
      })
    );
  }

  private async getWritableCalendar(client: DAVClient, calendarUrl?: string): Promise<DAVCalendar> {
    const calendars = await this.fetchTaskCalendars(client);
    const calendar = calendarUrl
      ? calendars.find((candidate) => candidate.url === calendarUrl)
      : calendars[0];

    if (!calendar) {
      throw new Error(calendarUrl ? `Task calendar not found: ${calendarUrl}` : "No task-capable calendar found");
    }
    return calendar;
  }

  private async findTaskObject(
    client: DAVClient,
    taskId: string,
    calendarUrl?: string
  ): Promise<{ task: CalDAVTask; object: DAVCalendarObject; calendar: DAVCalendar }> {
    const calendars = await this.fetchTaskCalendars(client);
    const targetCalendars = calendarUrl
      ? calendars.filter((calendar) => calendar.url === calendarUrl)
      : calendars;

    for (const calendar of targetCalendars) {
      const objects = await client.fetchCalendarObjects({
        calendar,
        filters: VTODO_FILTERS,
        urlFilter: () => true,
      });
      const calendarName = normalizeDisplayName(calendar.displayName, calendar.url);

      for (const object of objects) {
        const tasks = parseTasksFromICalendar(String(object.data ?? ""), {
          url: object.url,
          etag: object.etag,
          calendarUrl: calendar.url,
          calendarName,
        });
        const task = tasks.find((candidate) =>
          candidate.id === taskId || candidate.uid === taskId || candidate.url === taskId
        );

        if (task) {
          return { task, object, calendar };
        }
      }
    }

    throw new Error(`Task not found: ${taskId}`);
  }
}

export function buildTaskICalendar(params: BuildTaskICalendarParams): string {
  const uid = params.uid ?? crypto.randomUUID();
  const now = params.now ?? new Date();
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//infomaniak-mcp//CalDAV Tasks//EN");

  const task = new ICAL.Component("vtodo");
  task.addPropertyWithValue("uid", uid);
  task.addPropertyWithValue("summary", params.title);
  task.addPropertyWithValue("status", "NEEDS-ACTION");
  task.addPropertyWithValue("percent-complete", 0);
  setDateProperty(task, "created", now);
  setDateProperty(task, "dtstamp", now);
  setDateProperty(task, "last-modified", now);
  setOptionalTextProperty(task, "description", params.description);
  setOptionalDateProperty(task, "due", params.due);
  setOptionalNumberProperty(task, "priority", params.priority);
  setCategoriesProperty(task, params.categories);

  calendar.addSubcomponent(task);
  return calendar.toString();
}

export function updateTaskICalendar(ics: string, params: UpdateTaskICalendarParams): string {
  const component = new ICAL.Component(ICAL.parse(ics));
  const task = findTodoComponent(component, params.uid);
  const now = params.now ?? new Date();

  if (params.title !== undefined) {
    task.updatePropertyWithValue("summary", params.title);
  }
  if (params.description !== undefined) {
    setOptionalTextProperty(task, "description", params.description);
  }
  if (params.due !== undefined) {
    setOptionalDateProperty(task, "due", params.due);
  }
  if (params.priority !== undefined) {
    setOptionalNumberProperty(task, "priority", params.priority);
  }
  if (params.categories !== undefined) {
    setCategoriesProperty(task, params.categories);
  }
  if (params.status !== undefined) {
    task.updatePropertyWithValue("status", params.status.toUpperCase());
  }
  if (params.completed !== undefined) {
    setCompletionProperties(task, params.completed, now);
  }

  setDateProperty(task, "dtstamp", now);
  setDateProperty(task, "last-modified", now);
  return component.toString();
}

export function parseTasksFromICalendar(ics: string, source: TaskSource): CalDAVTask[] {
  if (!ics.trim()) {
    return [];
  }

  const component = new ICAL.Component(ICAL.parse(ics));
  const todos = component.getAllSubcomponents("vtodo");

  return todos.map((todo, index) => {
    const uid = stringValue(todo.getFirstPropertyValue("uid")) ?? `${source.url}#${index}`;
    const status = stringValue(todo.getFirstPropertyValue("status"))?.toUpperCase();
    const percentComplete = numberValue(todo.getFirstPropertyValue("percent-complete"));
    const completedAt = timeValue(todo.getFirstPropertyValue("completed"));

    return {
      id: uid,
      uid,
      url: source.url,
      etag: source.etag,
      calendarUrl: source.calendarUrl,
      calendarName: source.calendarName,
      title: stringValue(todo.getFirstPropertyValue("summary")) ?? "(untitled task)",
      description: stringValue(todo.getFirstPropertyValue("description")),
      status,
      completed: isCompleted(status, percentComplete, completedAt),
      priority: numberValue(todo.getFirstPropertyValue("priority")),
      due: timeValue(todo.getFirstPropertyValue("due")),
      created: timeValue(todo.getFirstPropertyValue("created")),
      lastModified: timeValue(todo.getFirstPropertyValue("last-modified")),
      categories: categoriesValue(todo),
      percentComplete,
      completedAt,
    };
  });
}

function calendarSupportsTasks(calendar: DAVCalendar): boolean {
  const components = calendar.components ?? [];
  return components.length === 0 || components.some((component) => component.toUpperCase() === "VTODO");
}

function findTodoComponent(component: ICAL.Component, uid?: string): ICAL.Component {
  const todos = component.getAllSubcomponents("vtodo");
  const todo = uid
    ? todos.find((candidate) => stringValue(candidate.getFirstPropertyValue("uid")) === uid)
    : todos[0];

  if (!todo) {
    throw new Error(uid ? `Task component not found for UID: ${uid}` : "No VTODO component found");
  }
  return todo;
}

function setCompletionProperties(task: ICAL.Component, completed: boolean, now: Date): void {
  if (completed) {
    task.updatePropertyWithValue("status", "COMPLETED");
    task.updatePropertyWithValue("percent-complete", 100);
    setDateProperty(task, "completed", now);
  } else {
    task.updatePropertyWithValue("status", "NEEDS-ACTION");
    task.updatePropertyWithValue("percent-complete", 0);
    task.removeAllProperties("completed");
  }
}

function setOptionalTextProperty(component: ICAL.Component, name: string, value?: string): void {
  if (value === undefined) {
    return;
  }
  if (value.length === 0) {
    component.removeAllProperties(name);
    return;
  }
  component.updatePropertyWithValue(name, value);
}

function setOptionalNumberProperty(component: ICAL.Component, name: string, value?: number | null): void {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    component.removeAllProperties(name);
    return;
  }
  component.updatePropertyWithValue(name, value);
}

function setOptionalDateProperty(component: ICAL.Component, name: string, value?: string | null): void {
  if (value === undefined) {
    return;
  }
  if (value === null || value.length === 0) {
    component.removeAllProperties(name);
    return;
  }
  component.updatePropertyWithValue(name, parseICalTime(value));
}

function setDateProperty(component: ICAL.Component, name: string, value: Date): void {
  component.updatePropertyWithValue(name, ICAL.Time.fromJSDate(value, true));
}

function setCategoriesProperty(component: ICAL.Component, categories?: string[]): void {
  if (categories === undefined) {
    return;
  }
  component.removeAllProperties("categories");
  const normalized = categories.map((category) => category.trim()).filter((category) => category.length > 0);
  if (normalized.length > 0) {
    const property = new ICAL.Property("categories");
    property.setValues(normalized);
    component.addProperty(property);
  }
}

function parseICalTime(value: string): ICAL.Time {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return ICAL.Time.fromDateString(value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid task date/time: ${value}`);
  }
  return ICAL.Time.fromJSDate(date, true);
}

function filterTasks(tasks: CalDAVTask[], options: TaskListOptions): CalDAVTask[] {
  const normalizedQuery = options.query?.trim().toLowerCase();
  const status = options.status ?? "all";

  return tasks.filter((task) => {
    if (status === "open" && task.completed) return false;
    if (status === "completed" && !task.completed) return false;
    if (!normalizedQuery) return true;

    const haystack = [
      task.title,
      task.description,
      task.status,
      task.calendarName,
      ...task.categories,
    ].filter(Boolean).join("\n").toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

function compareTasks(a: CalDAVTask, b: CalDAVTask): number {
  if (a.completed !== b.completed) {
    return a.completed ? 1 : -1;
  }

  const dueA = a.due ?? "9999-12-31T23:59:59.999Z";
  const dueB = b.due ?? "9999-12-31T23:59:59.999Z";
  if (dueA !== dueB) {
    return dueA.localeCompare(dueB);
  }

  return a.title.localeCompare(b.title);
}

function normalizeDisplayName(value: DAVCalendar["displayName"], fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timeValue(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "object" && "toJSDate" in value && typeof value.toJSDate === "function") {
    return value.toJSDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function categoriesValue(todo: ICAL.Component): string[] {
  return todo.getAllProperties("categories").flatMap((property) =>
    property.getValues().map((value) => String(value).trim()).filter((category) => category.length > 0)
  );
}

function isCompleted(status?: string, percentComplete?: number, completedAt?: string): boolean {
  return status === "COMPLETED" || percentComplete === 100 || Boolean(completedAt);
}
