import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TempResourceRegistry, registerTempResourceTemplate } from "../dist/temp-resources.js";

function createRecordingServer() {
  const resources = new Map();
  return {
    resources,
    registerResource(name, uriOrTemplate, config, callback) {
      resources.set(name, { uriOrTemplate, config, callback });
    },
  };
}

test("temp resource registry exposes saved files through resources/read", async () => {
  const directory = mkdtempSync(join(tmpdir(), "infomaniak-mcp-resource-test-"));
  const filePath = join(directory, "report.txt");
  writeFileSync(filePath, "hello resource", { mode: 0o600 });

  try {
    const registry = new TempResourceRegistry();
    const server = createRecordingServer();
    registerTempResourceTemplate(server, registry);

    const registered = registry.addFile({
      filePath,
      name: "report.txt",
      mimeType: "text/plain",
      description: "Saved report",
    });

    assert.match(registered.uri, /^infomaniak-temp:\/\//);
    assert.equal(registered.size, "hello resource".length);
    assert.match(registered.lastModified, /^\d{4}-\d{2}-\d{2}T/);

    const resource = server.resources.get("infomaniak_temp_file");
    assert.ok(resource, "resource template registered");

    const listed = await registry.list();
    assert.equal(listed.resources[0].size, "hello resource".length);
    assert.equal(listed.resources[0].lastModified, registered.lastModified);

    const result = await resource.callback(new URL(registered.uri), { id: registered.id });
    assert.equal(result.contents[0].uri, registered.uri);
    assert.equal(result.contents[0].mimeType, "text/plain");
    assert.equal(result.contents[0].text, "hello resource");
    assert.equal(result.contents[0].size, "hello resource".length);
    assert.equal(result.contents[0].lastModified, registered.lastModified);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("temp resource registry prunes expired resources and files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "infomaniak-mcp-resource-prune-test-"));
  const oldPath = join(directory, "old.txt");
  const freshPath = join(directory, "fresh.txt");
  writeFileSync(oldPath, "old", { mode: 0o600 });
  writeFileSync(freshPath, "fresh", { mode: 0o600 });

  try {
    let now = 10_000;
    const registry = new TempResourceRegistry({ ttlMs: 1000, now: () => now });
    const old = registry.addFile({ filePath: oldPath, name: "old.txt" });
    now += 2000;
    const fresh = registry.addFile({ filePath: freshPath, name: "fresh.txt" });

    const pruned = await registry.pruneExpired();

    assert.deepEqual(pruned, { removed: 1 });
    assert.equal(existsSync(oldPath), false);
    assert.equal(existsSync(freshPath), true);
    assert.equal((await registry.list()).resources.map((resource) => resource.uri).join(","), fresh.uri);
    await assert.rejects(() => registry.read(new URL(old.uri), old.id), /Unknown temporary resource/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
