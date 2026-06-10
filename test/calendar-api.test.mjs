import test from "node:test";
import assert from "node:assert/strict";

import { CalendarService } from "../dist/services/calendar.js";

function jsonResponse(body, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    headers: { get: () => "application/json" },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function makeConfig() {
  return {
    infomaniakToken: "calendar-token",
    mailToken: "",
    kdriveId: "",
    aiProductId: "",
    mailUser: "",
    mailPassword: "",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 587,
    davUser: "",
    davPassword: "",
    cardDavUrl: "",
    calDavUrl: "",
    enableExperimentalSwissTransfer: false,
    kchatToken: "",
    kchatTeamName: "",
  };
}

test("CalendarService caches calendar discovery across event listings", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/1/calendar/pim/calendar")) {
      return jsonResponse({
        result: "success",
        data: {
          calendars: [
            { id: "cal-1", name: "Work" },
            { id: "cal-2", name: "Personal" },
          ],
        },
      });
    }
    if (String(url).includes("/1/calendar/pim/event?")) {
      return jsonResponse({ result: "success", data: [] });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const calendar = new CalendarService(makeConfig());
    await calendar.listEvents("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z");
    await calendar.listEvents("2026-06-03T00:00:00Z", "2026-06-04T00:00:00Z");

    assert.equal(calls.filter((url) => url.endsWith("/1/calendar/pim/calendar")).length, 1);
    assert.equal(calls.filter((url) => url.includes("/1/calendar/pim/event?")).length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CalendarService sends recurrence rules and reminder offsets when creating and updating events", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/2/profile")) {
      return jsonResponse({
        result: "success",
        data: {
          email: "user@example.com",
          preferences: { timezone: { name: "Europe/Oslo" } },
        },
      });
    }
    if (String(url).endsWith("/1/calendar/pim/calendar")) {
      return jsonResponse({
        result: "success",
        data: { calendars: [{ id: "cal-1", name: "Work" }] },
      });
    }
    if (String(url).endsWith("/1/calendar/pim/event") && options.method === "POST") {
      return jsonResponse({ result: "success", data: { id: "event-1", title: "Standup" } });
    }
    if (String(url).includes("/1/calendar/pim/event?")) {
      return jsonResponse({
        result: "success",
        data: [{
          id: "event-1",
          title: "Standup",
          start: "2026-06-10 09:00:00",
          end: "2026-06-10 09:15:00",
          description: "",
          type: "event",
          fullday: false,
          timezone_start: "Europe/Oslo",
          timezone_end: "Europe/Oslo",
        }],
      });
    }
    if (String(url).endsWith("/1/calendar/pim/event/event-1") && options.method === "PUT") {
      return jsonResponse({ result: "success", data: { id: "event-1", title: "Updated standup" } });
    }
    throw new Error(`Unexpected request ${options.method ?? "GET"} ${url}`);
  };

  try {
    const calendar = new CalendarService(makeConfig());
    await calendar.createEvent({
      title: "Standup",
      start: "2026-06-10T09:00:00",
      end: "2026-06-10T09:15:00",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      reminderMinutes: [10, 60],
    });
    await calendar.updateEvent("event-1", {
      title: "Updated standup",
      recurrenceRule: "FREQ=DAILY;COUNT=5",
      reminderMinutes: [15],
    });

    const createBody = JSON.parse(calls.find((call) => call.options.method === "POST" && call.url.endsWith("/1/calendar/pim/event")).options.body);
    assert.equal(createBody.rrule, "FREQ=WEEKLY;BYDAY=MO,WE,FR");
    assert.deepEqual(createBody.reminders, [{ minutes_before: 10 }, { minutes_before: 60 }]);

    const updateBody = JSON.parse(calls.find((call) => call.options.method === "PUT").options.body);
    assert.equal(updateBody.rrule, "FREQ=DAILY;COUNT=5");
    assert.deepEqual(updateBody.reminders, [{ minutes_before: 15 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
