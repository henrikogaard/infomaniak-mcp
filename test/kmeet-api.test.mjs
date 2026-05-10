import test from "node:test";
import assert from "node:assert/strict";

import { KMeetService } from "../dist/services/kmeet.js";

function makeConfig() {
  return {
    infomaniakToken: "meet-token",
    mailToken: "",
    kdriveId: "",
    aiProductId: "",
    mailUser: "",
    mailPassword: "",
    imapHost: "mail.infomaniak.com",
    imapPort: 993,
    smtpHost: "mail.infomaniak.com",
    smtpPort: 587,
    davUser: "",
    davPassword: "",
    cardDavUrl: "https://sync.infomaniak.com",
    calDavUrl: "https://sync.infomaniak.com",
    enableExperimentalSwissTransfer: false,
  };
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "application/json" : "";
      },
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("KMeetService fetches room settings from the documented endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({
      result: "success",
      data: {
        lobby_enabled: true,
        password_enabled: true,
      },
    });
  };

  try {
    const kmeet = new KMeetService(makeConfig());
    const settings = await kmeet.getRoomSettings("room-123");

    assert.deepEqual(settings, {
      lobby_enabled: true,
      password_enabled: true,
    });
    assert.equal(calls[0].url, "https://api.infomaniak.com/1/kmeet/rooms/room-123/settings");
    assert.equal(calls[0].options.headers.Authorization, "Bearer meet-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
