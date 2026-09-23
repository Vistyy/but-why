import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Effect, Schema } from "effect";

const executable = resolve("dist/main.js");

const guide = spawnSync(process.execPath, [executable, "--rule-guide"], {
  cwd: tmpdir(),
  encoding: "utf8",
  timeout: 10_000,
});

assert.equal(guide.status, 0, guide.stderr);

assert.equal(guide.stderr, "");

assert.ok(guide.stdout.trim().length > 0, "Rule guide produced no output");

const help = spawnSync(process.execPath, [executable, "--help"], {
  cwd: tmpdir(),
  encoding: "utf8",
  timeout: 10_000,
});

assert.equal(help.status, 0, help.stderr);

assert.equal(help.stderr, "");

assert.ok(help.stdout.trim().length > 0, "Help produced no output");

const result = spawnSync(process.execPath, ["dist/main.js", "review", "unknown"], {
  encoding: "utf8",
  timeout: 10_000,
});

assert.equal(result.status, 1, `unexpected status: ${result.status}; stderr: ${result.stderr}`);

assert.equal(result.stderr, "");

const decode = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      incomplete: Schema.Boolean,
      error: Schema.String,
    }),
  ),
);

const output = await Effect.runPromise(decode(result.stdout));

assert.equal(output.incomplete, true);

assert.match(output.error, /^Usage:/);

const invalidLimit = spawnSync(
  process.execPath,
  ["dist/main.js", "review", "repository", "--at", "deadbeef", "--concurrency", "0"],
  { encoding: "utf8", timeout: 10_000 },
);

assert.equal(
  invalidLimit.status,
  1,
  `unexpected status: ${invalidLimit.status}; stderr: ${invalidLimit.stderr}`,
);

assert.equal(invalidLimit.stderr, "");

assert.match(
  (await Effect.runPromise(decode(invalidLimit.stdout))).error,
  /--concurrency must be a positive integer/,
);
