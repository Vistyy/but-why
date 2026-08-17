import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runByInProcessEffect } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("CLI Task ID boundary", () => {
  it.effect.each(["A".repeat(257), "BY-9007199254740992"])(
    "rejects an invalid Task ID at the CLI boundary",
    (taskId) =>
      Effect.gen(function* () {
        const result = yield* runByInProcessEffect(createTestWorkspace(), ["task", "show", taskId]);

        expect(result.status).toBe(2);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({
          error: { code: "invalid_task_id" },
        });
      }),
  );
});
