import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("release metadata is pinned for 1.0.0", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const indexSource = readFileSync("src/index.ts", "utf8");

  assert.equal(packageJson.version, "1.0.0");
  assert.equal(packageLock.version, "1.0.0");
  assert.equal(packageLock.packages[""].version, "1.0.0");
  assert.equal(packageJson.dependencies["@modelcontextprotocol/sdk"], "1.29.0");
  assert.equal(packageLock.packages[""].dependencies["@modelcontextprotocol/sdk"], "1.29.0");
  assert.match(indexSource, /version:\s*"1\.0\.0"/);
});
