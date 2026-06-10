#!/usr/bin/env node

import { spawn } from "node:child_process";

const checks = [
  ["npm test", "npm", ["test"]],
  ["git diff --check", "git", ["diff", "--check"]],
  ["npm pack --dry-run", "npm", ["pack", "--dry-run"]],
];

if (isEnabled(process.env.VERIFY_RELEASE_MCP)) {
  checks.push(["npm run verify:mcp", "npm", ["run", "verify:mcp"]]);
}

if (isEnabled(process.env.VERIFY_RELEASE_SMOKE)) {
  checks.push(["npm run smoke:readonly", "npm", ["run", "smoke:readonly"]]);
}

for (const [label, command, args] of checks) {
  console.error(`[verify:release] ${label}`);
  await run(command, args);
}

console.error("[verify:release] all checks passed");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
    child.on("error", reject);
  });
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}
