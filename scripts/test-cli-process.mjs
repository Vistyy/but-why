import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["dist/main.js", "review", "unknown"], {
  encoding: "utf8",
  timeout: 10_000,
});
assert.equal(result.status, 1, `unexpected status: ${result.status}; stderr: ${result.stderr}`);
assert.equal(result.stderr, "");
const output = JSON.parse(result.stdout);
assert.equal(output.incomplete, true);
assert.match(output.error, /^Usage:/);
