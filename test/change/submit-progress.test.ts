import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import {
  runWithSubmitProgress,
  stderrSubmitProgress,
} from "../../src/change/validation/submitProgress.js";

describe("Change Submit progress", () => {
  it("writes reviewer facts and concise completion durations to stderr", () => {
    const output: string[] = [];
    const progress = stderrSubmitProgress((message) => output.push(message));

    progress.started({
      kind: "acceptance",
      profile: {
        name: "reviewer",
        model: "openai-codex/gpt-5.6-luna",
        thinking: "high",
      },
    });
    progress.completed(
      {
        kind: "acceptance",
        profile: {
          name: "reviewer",
          model: "openai-codex/gpt-5.6-luna",
          thinking: "high",
        },
      },
      "passed",
      6 * 60_000 + 49_000,
      { continuity: "resumed", reviewCalls: 1 },
    );

    expect(output).toEqual([
      "Acceptance Review started: profile=reviewer model=openai-codex/gpt-5.6-luna thinking=high\n",
      "Acceptance Review passed in 6m49s continuity=resumed reviewCalls=1\n",
    ]);
  });

  it.effect("reports failed phases without exposing the failure detail", () =>
    Effect.gen(function* () {
      const output: string[] = [];
      const progress = stderrSubmitProgress((message) => output.push(message));

      const result = yield* Effect.either(
        runWithSubmitProgress({
          progress,
          phase: { kind: "prepare" },
          run: Effect.fail("private failure detail"),
          outcome: () => "passed",
        }),
      );

      expect(result._tag).toBe("Left");
      expect(output).toEqual(["Prepare started\n", "Prepare failed in 0s\n"]);
      expect(output.join("")).not.toContain("private failure detail");
    }),
  );
});
