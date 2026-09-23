import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Effect, Schema } from "effect";

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
