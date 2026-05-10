import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTaskICalendar,
  parseTasksFromICalendar,
  updateTaskICalendar,
} from "../dist/services/caldav-tasks.js";

const sampleTask = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//infomaniak-mcp//tests//EN",
  "BEGIN:VTODO",
  "UID:task-123",
  "SUMMARY:Prepare roadmap",
  "DESCRIPTION:Capture the task work\\nwith enough detail",
  "STATUS:NEEDS-ACTION",
  "PRIORITY:3",
  "DUE:20260511T090000Z",
  "CREATED:20260510T080000Z",
  "LAST-MODIFIED:20260510T081500Z",
  "CATEGORIES:work,planning",
  "END:VTODO",
  "END:VCALENDAR",
].join("\r\n");

test("parseTasksFromICalendar extracts VTODO fields", () => {
  const tasks = parseTasksFromICalendar(sampleTask, {
    url: "https://sync.infomaniak.com/caldav/task-123.ics",
    etag: '"abc"',
    calendarUrl: "https://sync.infomaniak.com/caldav/personal/",
    calendarName: "Personal",
  });

  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0], {
    id: "task-123",
    uid: "task-123",
    url: "https://sync.infomaniak.com/caldav/task-123.ics",
    etag: '"abc"',
    calendarUrl: "https://sync.infomaniak.com/caldav/personal/",
    calendarName: "Personal",
    title: "Prepare roadmap",
    description: "Capture the task work\nwith enough detail",
    status: "NEEDS-ACTION",
    completed: false,
    priority: 3,
    due: "2026-05-11T09:00:00.000Z",
    created: "2026-05-10T08:00:00.000Z",
    lastModified: "2026-05-10T08:15:00.000Z",
    categories: ["work", "planning"],
    percentComplete: undefined,
    completedAt: undefined,
  });
});

test("parseTasksFromICalendar marks completed VTODOs", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTODO",
    "UID:done-1",
    "SUMMARY:Already handled",
    "STATUS:COMPLETED",
    "PERCENT-COMPLETE:100",
    "COMPLETED:20260510T090000Z",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n");

  const [task] = parseTasksFromICalendar(ics, {
    url: "https://sync.infomaniak.com/caldav/done-1.ics",
    calendarUrl: "https://sync.infomaniak.com/caldav/personal/",
    calendarName: "Personal",
  });

  assert.equal(task.completed, true);
  assert.equal(task.percentComplete, 100);
  assert.equal(task.completedAt, "2026-05-10T09:00:00.000Z");
});

test("buildTaskICalendar creates a VTODO task document", () => {
  const ics = buildTaskICalendar({
    uid: "new-task-1",
    title: "Write task support",
    description: "Make CalDAV tasks writable",
    due: "2026-05-12T10:30:00Z",
    priority: 5,
    categories: ["mcp", "tasks"],
    now: new Date("2026-05-10T09:00:00Z"),
  });

  const [task] = parseTasksFromICalendar(ics, {
    url: "https://sync.infomaniak.com/caldav/new-task-1.ics",
    calendarUrl: "https://sync.infomaniak.com/caldav/personal/",
    calendarName: "Personal",
  });

  assert.equal(task.uid, "new-task-1");
  assert.equal(task.title, "Write task support");
  assert.equal(task.description, "Make CalDAV tasks writable");
  assert.equal(task.status, "NEEDS-ACTION");
  assert.equal(task.completed, false);
  assert.equal(task.due, "2026-05-12T10:30:00.000Z");
  assert.equal(task.priority, 5);
  assert.deepEqual(task.categories, ["mcp", "tasks"]);
  assert.equal(task.created, "2026-05-10T09:00:00.000Z");
});

test("updateTaskICalendar can complete and reopen a task", () => {
  const completed = updateTaskICalendar(sampleTask, {
    completed: true,
    now: new Date("2026-05-13T12:00:00Z"),
  });

  const [doneTask] = parseTasksFromICalendar(completed, {
    url: "https://sync.infomaniak.com/caldav/task-123.ics",
    calendarUrl: "https://sync.infomaniak.com/caldav/personal/",
    calendarName: "Personal",
  });

  assert.equal(doneTask.uid, "task-123");
  assert.equal(doneTask.status, "COMPLETED");
  assert.equal(doneTask.completed, true);
  assert.equal(doneTask.percentComplete, 100);
  assert.equal(doneTask.completedAt, "2026-05-13T12:00:00.000Z");

  const reopened = updateTaskICalendar(completed, {
    completed: false,
    now: new Date("2026-05-13T12:05:00Z"),
  });

  const [openTask] = parseTasksFromICalendar(reopened, {
    url: "https://sync.infomaniak.com/caldav/task-123.ics",
    calendarUrl: "https://sync.infomaniak.com/caldav/personal/",
    calendarName: "Personal",
  });

  assert.equal(openTask.status, "NEEDS-ACTION");
  assert.equal(openTask.completed, false);
  assert.equal(openTask.percentComplete, 0);
  assert.equal(openTask.completedAt, undefined);
  assert.equal(openTask.lastModified, "2026-05-13T12:05:00.000Z");
});
