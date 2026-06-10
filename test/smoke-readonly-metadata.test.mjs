import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = readFileSync(resolve(repoRoot, "scripts/smoke-readonly.mjs"), "utf8");

test("read-only smoke validates MCP metadata and prompts without mutating data", () => {
  assert.match(source, /tool_metadata/);
  assert.match(source, /readOnlyHint/);
  assert.match(source, /outputSchema/);
  assert.match(source, /prompts\/list/);
  assert.match(source, /resources\/templates\/list/);
  assert.match(source, /infomaniak_temp_file/);
  assert.match(source, /infomaniak_help/);
  assert.match(source, /contacts_query/);
  assert.match(source, /summarize_unread_mail/);
});
