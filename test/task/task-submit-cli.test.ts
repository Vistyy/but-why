import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  type ReviewerAgentInput,
  type ReviewerAgentResult,
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { TaskReviewReviewerOutput } from "../../src/task/taskReviewPolicy.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

const taggedReviewerOutput = (value: unknown): string =>
  `<reviewer-output>${JSON.stringify(value)}</reviewer-output>`;

const reviewerThatPasses = (
  reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[],
): ReviewerAgentRuntime<TaskReviewReviewerOutput> => ({
  review: (input) =>
    Effect.sync((): ReviewerAgentResult<TaskReviewReviewerOutput> => {
      reviewInputs.push(input);
      return {
        ok: true,
        report: { findings: [] },
        attempts: 1,
        stdout: taggedReviewerOutput({ findings: [] }),
      };
    }),
});

const reviewerThatBlocks = (
  reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[],
): ReviewerAgentRuntime<TaskReviewReviewerOutput> => ({
  review: (input) =>
    Effect.sync((): ReviewerAgentResult<TaskReviewReviewerOutput> => {
      reviewInputs.push(input);
      return {
        ok: true,
        report: {
          findings: [
            {
              title: "Missing evidence",
              description: "The proposal needs repository evidence.",
              evidence: "command: none\nexitCode: 0",
              files: [],
            },
          ],
        },
        attempts: 1,
        stdout: taggedReviewerOutput({
          findings: [
            {
              title: "Missing evidence",
              description: "The proposal needs repository evidence.",
              evidence: "command: none\nexitCode: 0",
              files: [],
            },
          ],
        }),
      };
    }),
});

const createInitializedTask = () =>
  Effect.gen(function* () {
    const root = yield* Effect.sync(() => createGitRepo());
    const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
    if (initialized.status !== 0) throw new Error(initialized.stdout || initialized.stderr);
    mkdirSync(join(root, ".but-why"), { recursive: true });
    writeFileSync(join(root, ".but-why", "config.json"), JSON.stringify({ taskPrefix: "BY" }));
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(
      join(root, ".test-global-config.json"),
      JSON.stringify({
        defaultAgentProfile: { name: "task-reviewer", scope: "global" },
        agentProfiles: {
          "task-reviewer": { agentRuntime: "pi", runtimeConfig: { model: "test-model" } },
        },
      }),
    );
    writeFileSync(join(root, "task.md"), "Implement the requested change.");
    const created = yield* runByInProcessEffect(root, [
      "task",
      "create",
      "--title",
      "Cli proposal",
      "--file",
      "task.md",
    ]);
    if (created.status !== 0) throw new Error(created.stdout || created.stderr);
    return root;
  });

describe("by task submission CLI", () => {
  it.effect(
    "submits a passing advisory Task Review and leaves the Task New",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { taskReviewerAgentRuntime: reviewerThatPasses(reviewInputs) },
        );

        expect(submitted.status).toBe(0);
        expect(submitted.stderr).toBe("");
        const result = JSON.parse(submitted.stdout) as {
          readonly review: {
            readonly id: string;
            readonly outcome: string;
            readonly baseCommit: string;
            readonly task: { readonly id: string; readonly state: string };
          };
          readonly nextAction: string;
        };
        expect(result.review.outcome).toBe("passed");
        expect(result.review.task).toEqual({ id: "BY-1", state: "new" });
        expect(result.review.baseCommit).toMatch(/^[0-9a-f]{40}$/u);
        expect(result.nextAction).toBe("by task approve BY-1");
        expect(reviewInputs).toHaveLength(1);

        const shown = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
        expect(shown.status).toBe(0);
        const show = JSON.parse(shown.stdout) as {
          readonly taskReview?: { readonly latest?: { readonly outcome: string } };
          readonly nextAction?: string;
        };
        expect(show.taskReview?.latest?.outcome).toBe("passed");
        expect(show.nextAction).toBe(`by task approve BY-1`);
      }),
    60_000,
  );

  it.effect(
    "submits a blocked Task Review with Findings and reports the next action",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { taskReviewerAgentRuntime: reviewerThatBlocks(reviewInputs) },
        );

        expect(submitted.status).toBe(0);
        const result = JSON.parse(submitted.stdout) as {
          readonly review: {
            readonly id: string;
            readonly outcome: string;
            readonly task: { readonly id: string; readonly state: string };
            readonly findings?: readonly { readonly title: string }[];
          };
          readonly nextAction?: string;
        };
        expect(result.review.outcome).toBe("blocked");
        expect(result.review.task).toEqual({ id: "BY-1", state: "new" });
        expect(result.review.findings).toEqual([
          expect.objectContaining({ title: "Missing evidence" }),
        ]);
        expect(result.nextAction).toBe("by task context draft BY-1");

        const shown = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
        expect(JSON.parse(shown.stdout)).toMatchObject({
          taskReview: { latest: { outcome: "blocked" } },
          nextAction: "by task context draft BY-1",
        });
      }),
    60_000,
  );

  it.effect(
    "reports a tooling-failed Review and its valid retry action",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          {
            taskReviewerAgentRuntime: {
              review: () =>
                Effect.succeed({
                  ok: false,
                  failure: new ReviewerExecutionFailed({
                    operationName: "run_reviewer_agent",
                    message: "Reviewer unavailable.",
                  }),
                  sessionUsability: "unknown",
                  attempts: 1,
                  stdout: "",
                }),
            },
          },
        );

        expect(submitted.status).toBe(0);
        expect(JSON.parse(submitted.stdout)).toMatchObject({
          review: {
            outcome: "tooling_failed",
            task: { id: "BY-1", state: "new" },
            toolingFailures: [
              {
                errorKind: "infrastructure_tooling_failed",
                operationName: "run_reviewer_agent",
                errorMessage: "Reviewer unavailable.",
              },
            ],
          },
          nextAction: "by task submit BY-1",
        });

        const shown = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
        expect(JSON.parse(shown.stdout)).toMatchObject({
          taskReview: { latest: { outcome: "tooling_failed" } },
          nextAction: "by task submit BY-1",
        });
      }),
    60_000,
  );

  it.effect(
    "starts a fresh Review after a completed Review",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
        const first = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { taskReviewerAgentRuntime: reviewerThatBlocks(reviewInputs) },
        );
        expect(first.status).toBe(0);
        expect(reviewInputs).toHaveLength(1);

        const second = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          secondNow,
          { taskReviewerAgentRuntime: reviewerThatBlocks(reviewInputs) },
        );
        expect(second.status).toBe(0);
        const result = JSON.parse(second.stdout) as {
          readonly review: { readonly id: string; readonly outcome: string };
        };
        expect(result.review.id).not.toBe(
          (JSON.parse(first.stdout) as { review: { id: string } }).review.id,
        );
        expect(result.review.outcome).toBe("blocked");
        expect(reviewInputs).toHaveLength(2);
      }),
    60_000,
  );

  it.effect(
    "starts a fresh Review after a passing advisory Review",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput<TaskReviewReviewerOutput>[] = [];
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { taskReviewerAgentRuntime: reviewerThatPasses(reviewInputs) },
        );
        expect(submitted.status).toBe(0);

        const again = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          secondNow,
          { taskReviewerAgentRuntime: reviewerThatPasses(reviewInputs) },
        );
        expect(again.status).toBe(0);
        const firstReview = (JSON.parse(submitted.stdout) as { review: { id: string } }).review.id;
        const secondReview = (JSON.parse(again.stdout) as { review: { id: string } }).review.id;
        expect(secondReview).not.toBe(firstReview);
        expect(reviewInputs).toHaveLength(2);
      }),
    60_000,
  );

  it.effect("reports an unknown Task for submission", () =>
    Effect.gen(function* () {
      const root = yield* createInitializedTask();
      const result = yield* runByInProcessEffect(root, ["--json", "task", "submit", "BY-99"]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "task_not_found" },
      });
    }),
  );

  it.effect("reports an unknown Review for abandonment", () =>
    Effect.gen(function* () {
      const root = yield* createInitializedTask();
      const result = yield* runByInProcessEffect(root, [
        "--json",
        "task-review",
        "abandon",
        "review-unknown",
        "--reason",
        "No longer needed",
      ]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "review_not_found" },
      });
    }),
  );
});
