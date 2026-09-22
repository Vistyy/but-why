import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Effect, Schema } from "effect";

const result = spawnSync(process.execPath, ["dist/main.js", "review", "unknown"], {
  encoding: "utf8",
  timeout: 10_000,
});

assert.equal(result.status, 1, `unexpected status: ${result.status}; stderr: ${result.stderr}`);

assert.equal(result.stderr, "");

const output = await Effect.runPromise(
  Schema.decodeEffect(
    Schema.fromJsonString(
      Schema.Struct({
        incomplete: Schema.Boolean,
        error: Schema.String,
      }),
    ),
  )(result.stdout),
);

assert.equal(output.incomplete, true);

assert.match(output.error, /^Usage:/);
