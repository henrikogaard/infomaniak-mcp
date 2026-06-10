import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("release verification scripts are packaged and include expected checks", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const verifyReleasePath = resolve(repoRoot, "scripts/verify-release.mjs");
  const verifyMcpPath = resolve(repoRoot, "scripts/verify-mcp.mjs");

  assert.equal(packageJson.scripts["verify:release"], "node scripts/verify-release.mjs");
  assert.equal(packageJson.scripts["verify:mcp"], "node scripts/verify-mcp.mjs");
  assert.equal(existsSync(verifyReleasePath), true);
  assert.equal(existsSync(verifyMcpPath), true);

  const releaseSource = readFileSync(verifyReleasePath, "utf8");
  assert.match(releaseSource, /npm test/);
  assert.match(releaseSource, /git diff --check/);
  assert.match(releaseSource, /npm pack --dry-run/);
  assert.match(releaseSource, /VERIFY_RELEASE_SMOKE/);

  const mcpSource = readFileSync(verifyMcpPath, "utf8");
  assert.match(mcpSource, /tools\/list/);
  assert.match(mcpSource, /prompts\/list/);
  assert.match(mcpSource, /resources\/templates\/list/);
});
