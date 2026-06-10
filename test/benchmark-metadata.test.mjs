import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("read-only benchmark script is packaged and uses MCP timing probes", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const scriptPath = resolve(repoRoot, "scripts/bench-readonly.mjs");

  assert.equal(packageJson.scripts["bench:readonly"], "node scripts/bench-readonly.mjs");
  assert.equal(existsSync(scriptPath), true);

  const source = readFileSync(scriptPath, "utf8");
  assert.match(source, /tools\/list/);
  assert.match(source, /mail_query/);
  assert.match(source, /contacts_query/);
  assert.match(source, /p50Ms/);
  assert.match(source, /p95Ms/);
  assert.match(source, /BENCH_ITERATIONS/);
});
