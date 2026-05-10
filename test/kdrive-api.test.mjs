import test from "node:test";
import assert from "node:assert/strict";

import { KDriveService } from "../dist/services/kdrive.js";

function makeConfig() {
  return {
    infomaniakToken: "drive-token",
    mailToken: "",
    kdriveId: "42",
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

test("KDriveService manages share links through the documented API", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ result: "success", data: { url: "https://kdrive.example/share" } });
  };

  try {
    const kdrive = new KDriveService(makeConfig());

    await kdrive.createShareLink(123, { right: "public", canDownload: true });
    await kdrive.updateShareLink(123, { password: "secret", validUntil: 40369 });
    await kdrive.listShareLinks({ limit: 5, type: "file" });
    await kdrive.deleteShareLink(123);

    assert.equal(calls[0].url, "https://api.infomaniak.com/2/drive/42/files/123/link");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Authorization, "Bearer drive-token");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      right: "public",
      can_download: true,
    });

    assert.equal(calls[1].url, "https://api.infomaniak.com/2/drive/42/files/123/link");
    assert.equal(calls[1].options.method, "PUT");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      password: "secret",
      valid_until: 40369,
    });

    assert.equal(calls[2].url, "https://api.infomaniak.com/3/drive/42/files/links?limit=5&type=file");
    assert.equal(calls[2].options.method ?? "GET", "GET");

    assert.equal(calls[3].url, "https://api.infomaniak.com/2/drive/42/files/123/link");
    assert.equal(calls[3].options.method, "DELETE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KDriveService restores versions and trashed files", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ result: "success", data: [{ id: 1 }] });
  };

  try {
    const kdrive = new KDriveService(makeConfig());

    await kdrive.listVersions(123, { perPage: 10 });
    await kdrive.restoreVersion(123, 9);
    await kdrive.restoreVersionToDirectory(123, 9, 55, "restored.txt");
    await kdrive.listTrash({ limit: 10 });
    await kdrive.restoreFromTrash(999, 1);

    assert.equal(calls[0].url, "https://api.infomaniak.com/3/drive/42/files/123/versions?per_page=10");
    assert.equal(calls[1].url, "https://api.infomaniak.com/3/drive/42/files/123/versions/9/restore");
    assert.equal(calls[1].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].options.body), {});
    assert.equal(calls[2].url, "https://api.infomaniak.com/3/drive/42/files/123/versions/9/restore/55");
    assert.deepEqual(JSON.parse(calls[2].options.body), { name: "restored.txt" });
    assert.equal(calls[3].url, "https://api.infomaniak.com/3/drive/42/trash?limit=10");
    assert.equal(calls[4].url, "https://api.infomaniak.com/2/drive/42/trash/999/restore");
    assert.deepEqual(JSON.parse(calls[4].options.body), { destination_directory_id: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KDriveService exposes comments and file activity", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ result: "success", data: [{ id: 7, body: "Looks good" }] });
  };

  try {
    const kdrive = new KDriveService(makeConfig());

    await kdrive.listComments(123, { perPage: 20 });
    await kdrive.addComment(123, "Looks good");
    await kdrive.replyToComment(123, 7, "Agreed");
    await kdrive.listFileActivities(123, { limit: 25, actions: "edit" });

    assert.equal(calls[0].url, "https://api.infomaniak.com/2/drive/42/files/123/comments?per_page=20");
    assert.equal(calls[1].url, "https://api.infomaniak.com/2/drive/42/files/123/comments");
    assert.deepEqual(JSON.parse(calls[1].options.body), { body: "Looks good" });
    assert.equal(calls[2].url, "https://api.infomaniak.com/2/drive/42/files/123/comments/7");
    assert.deepEqual(JSON.parse(calls[2].options.body), { body: "Agreed" });
    assert.equal(calls[3].url, "https://api.infomaniak.com/3/drive/42/files/123/activities?limit=25&actions=edit");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
