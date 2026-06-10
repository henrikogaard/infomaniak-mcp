import test from "node:test";
import assert from "node:assert/strict";

import { KPasteService } from "../dist/services/kpaste.js";
import { registerKPasteTools } from "../dist/tools/kpaste.js";

function createRecordingServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, config, callback) {
      tools.set(name, { config, callback });
    },
  };
}

test("kpaste_create warns that returned fragment URLs are transcript-visible secrets", async () => {
  const server = createRecordingServer();
  registerKPasteTools(server, {
    async createPaste() {
      return {
        id: "paste-1",
        url: "https://kpaste.infomaniak.com/paste-1#secret-key",
      };
    },
  });

  const tool = server.tools.get("kpaste_create");
  assert.match(tool.config.description, /trusted transcript/i);
  assert.doesNotMatch(tool.config.description, /passwords/i);
  assert.equal(tool.config.annotations.readOnlyHint, false);
  assert.equal(tool.config.annotations.destructiveHint, false);
  assert.ok(tool.config.outputSchema);

  const result = await tool.callback({ content: "secret" });
  assert.match(result.content[0].text, /Treat the full URL as a secret/i);
  assert.match(result.content[0].text, /transcript/i);
  assert.equal(result.structuredContent.id, "paste-1");
  assert.equal(result.structuredContent.url, "https://kpaste.infomaniak.com/paste-1#secret-key");
});

test("KPasteService can read and decrypt a paste URL using the fragment key", async () => {
  const originalFetch = globalThis.fetch;
  let postedBody;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/components/paste") && options.method === "POST") {
      postedBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return { result: "success", data: "paste-1" };
        },
        async text() {
          return "";
        },
      };
    }
    if (String(url).endsWith("/api/components/paste/paste-1") && (options.method ?? "GET") === "GET") {
      return {
        ok: true,
        async json() {
          return {
            result: "success",
            data: {
              ...postedBody,
              expirated_at: 1780000000,
            },
          };
        },
        async text() {
          return "";
        },
      };
    }
    throw new Error(`Unexpected kPaste request ${options.method ?? "GET"} ${url}`);
  };

  try {
    const service = new KPasteService({});
    const created = await service.createPaste({
      content: "secret message",
      password: "extra-secret",
    });
    const read = await service.readPaste({
      url: created.url,
      password: "extra-secret",
    });

    assert.equal(read.id, "paste-1");
    assert.equal(read.content, "secret message");
    assert.equal(read.passwordProtected, true);
    assert.equal(read.burnAfterReading, false);
    assert.equal(read.expiresAt, "2026-05-28T20:26:40.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("kpaste_read is marked destructive because burn-after-reading pastes may be consumed", async () => {
  const server = createRecordingServer();
  registerKPasteTools(server, {
    async createPaste() {
      return {
        id: "paste-1",
        url: "https://kpaste.infomaniak.com/paste-1#secret-key",
      };
    },
    async readPaste() {
      return {
        id: "paste-1",
        content: "secret",
        burnAfterReading: true,
        passwordProtected: false,
      };
    },
  });

  const tool = server.tools.get("kpaste_read");
  assert.equal(tool.config.annotations.readOnlyHint, false);
  assert.equal(tool.config.annotations.destructiveHint, true);

  const unsafe = await tool.callback({
    url: "https://kpaste.infomaniak.com/paste-1#secret-key",
  });
  assert.equal(unsafe.isError, true);
  assert.match(unsafe.content[0].text, /ACKNOWLEDGE KPASTE READ RISK/);

  const result = await tool.callback({
    url: "https://kpaste.infomaniak.com/paste-1#secret-key",
    confirmation: "ACKNOWLEDGE KPASTE READ RISK",
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.content, "secret");
});
