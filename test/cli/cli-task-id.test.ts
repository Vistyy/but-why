import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runByInProcessEffect } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("CLI Task ID boundary", () => {
  it.effect("rejects an overlong Task ID at the CLI boundary", () =>
    Effect.gen(function* () {
      const taskId = "A".repeat(257);
      const result = yield* runByInProcessEffect(createTestWorkspace(), ["task", "show", taskId]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "invalid_task_id" },
      });
    }),
  );
});
