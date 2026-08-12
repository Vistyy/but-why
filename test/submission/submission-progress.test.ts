import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import {
  runWithSubmitProgress,
  stderrSubmitProgress,
} from "../../src/submission/submissionProgress.js";

describe("Submission progress", () => {
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

  it("uses shared Task Submission phase vocabulary and ignores progress-write failures", () => {
    const output: string[] = [];
    const progress = stderrSubmitProgress((message) => output.push(message));

    progress.started({
      kind: "taskReview",
      profile: { name: "task-review", model: "provider/model", thinking: "high" },
    });
    progress.completed(
      {
        kind: "taskReview",
        profile: { name: "task-review", model: "provider/model", thinking: "high" },
      },
      "failed",
      1_000,
      { continuity: "fresh", reviewCalls: 2 },
    );

    expect(output).toEqual([
      "Task Review started: profile=task-review model=provider/model thinking=high\n",
      "Task Review failed in 1s continuity=fresh reviewCalls=2\n",
    ]);
    const failingProgress = stderrSubmitProgress(() => {
      throw new Error("stderr unavailable");
    });
    expect(() => failingProgress.started({ kind: "repositoryPreparation" })).not.toThrow();
    expect(() =>
      failingProgress.completed({ kind: "repositoryPreparation" }, "passed", 0),
    ).not.toThrow();
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
