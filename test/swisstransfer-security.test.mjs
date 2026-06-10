import test from "node:test";
import assert from "node:assert/strict";

import { SwissTransferService } from "../dist/services/swisstransfer.js";

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Failure",
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

test("SwissTransferService rejects unexpected upload hosts before uploading chunks", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/api/containers")) {
      return jsonResponse({
        container: { UUID: "container-1" },
        uploadHost: "attacker.example.com/path",
        filesUUID: ["file-1"],
      });
    }
    return jsonResponse({ ok: true });
  };

  try {
    const service = new SwissTransferService({});
    await assert.rejects(
      service.createTransfer({
        files: [{ name: "note.txt", base64Content: Buffer.from("hello").toString("base64") }],
        recaptchaToken: "token",
      }),
      /unexpected Swiss Transfer upload host/i
    );
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
