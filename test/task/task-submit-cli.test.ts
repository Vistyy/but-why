import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import type {
  ReviewerAgentInput,
  ReviewerAgentResult,
  ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import { SandcastleToolingFailed } from "../../src/change/validation/validationToolingFailures.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

const taggedReviewerOutput = (value: unknown): string =>
  `<reviewer-output>${JSON.stringify(value)}</reviewer-output>`;

const reviewerThatPasses = (reviewInputs: ReviewerAgentInput[]): ReviewerAgentRuntime => ({
  review: (input) =>
    Effect.sync((): ReviewerAgentResult => {
      reviewInputs.push(input);
      return {
        ok: true,
        report: { findings: [] },
        attempts: 1,
        stdout: taggedReviewerOutput({ findings: [] }),
      };
    }),
});

const reviewerThatBlocks = (reviewInputs: ReviewerAgentInput[]): ReviewerAgentRuntime => ({
  review: (input) =>
    Effect.sync((): ReviewerAgentResult => {
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
              artifactRefs: [],
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
    writeFileSync(
      join(root, ".but-why", "config.json"),
      JSON.stringify({
        taskPrefix: "BY",
        review: { task: { agentProfile: { name: "task-reviewer", scope: "repo" } } },
        agentProfiles: {
          "task-reviewer": { agentRuntime: "pi", runtimeConfig: { model: "test-model" } },
        },
      }),
    );
    commitButWhyConfigAndRecordDefault(root);
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
    "submits a passing Task Review and reports approval",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput[] = [];
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { reviewerAgentRuntime: reviewerThatPasses(reviewInputs) },
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
        };
        expect(result.review.outcome).toBe("passed");
        expect(result.review.task).toEqual({ id: "BY-1", state: "todo" });
        expect(result.review.baseCommit).toMatch(/^[0-9a-f]{40}$/u);
        expect(reviewInputs).toHaveLength(1);

        const shown = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
        expect(shown.status).toBe(0);
        const show = JSON.parse(shown.stdout) as {
          readonly taskReview?: { readonly latest?: { readonly outcome: string } };
          readonly nextAction?: string;
        };
        expect(show.taskReview?.latest?.outcome).toBe("passed");
        expect(show.nextAction).toBe(`by change start --task BY-1`);
      }),
    60_000,
  );

  it.effect(
    "submits a blocked Task Review with Findings and reports the next action",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput[] = [];
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { reviewerAgentRuntime: reviewerThatBlocks(reviewInputs) },
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
        expect(result.nextAction).toContain("by task-review show");

        const reviews = yield* runByInProcessEffect(root, ["--json", "task", "reviews", "BY-1"]);
        expect(reviews.status).toBe(0);
        const listed = JSON.parse(reviews.stdout) as {
          readonly reviews: readonly { readonly id: string; readonly outcome: string }[];
        };
        expect(listed.reviews).toHaveLength(1);
        expect(listed.reviews[0]).toMatchObject({ outcome: "blocked" });

        const shown = yield* runByInProcessEffect(root, [
          "--json",
          "task-review",
          "show",
          result.review.id,
        ]);
        expect(shown.status).toBe(0);
        const reviewShow = JSON.parse(shown.stdout) as {
          readonly review: {
            readonly state: string;
            readonly outcome: string;
            readonly findings: readonly { readonly title: string }[];
            readonly policy: { readonly version: number; readonly instructions: string };
          };
        };
        expect(reviewShow.review.state).toBe("complete");
        expect(reviewShow.review.outcome).toBe("blocked");
        expect(reviewShow.review.findings).toEqual([
          expect.objectContaining({ title: "Missing evidence" }),
        ]);
        expect(reviewShow.review.policy.version).toBe(1);
        expect(reviewShow.review.policy.instructions.length).toBeGreaterThan(0);
      }),
    60_000,
  );

  it.effect(
    "reuses the newest matching completed Review without another Review run",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput[] = [];
        const first = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { reviewerAgentRuntime: reviewerThatBlocks(reviewInputs) },
        );
        expect(first.status).toBe(0);
        expect(reviewInputs).toHaveLength(1);

        const second = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          secondNow,
          { reviewerAgentRuntime: reviewerThatBlocks(reviewInputs) },
        );
        expect(second.status).toBe(0);
        const result = JSON.parse(second.stdout) as {
          readonly review: { readonly reused?: boolean; readonly outcome: string };
        };
        expect(result.review.reused).toBe(true);
        expect(result.review.outcome).toBe("blocked");
        expect(reviewInputs).toHaveLength(1);
      }),
    60_000,
  );

  it.effect(
    "rejects submission for a Task that is already approved",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput[] = [];
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { reviewerAgentRuntime: reviewerThatPasses(reviewInputs) },
        );
        expect(submitted.status).toBe(0);

        const again = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          secondNow,
          { reviewerAgentRuntime: reviewerThatPasses(reviewInputs) },
        );
        expect(again.status).toBe(1);
        expect(JSON.parse(again.stdout)).toMatchObject({
          error: { code: "invalid_task_state", state: "todo" },
        });
        expect(reviewInputs).toHaveLength(1);
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

  it.effect(
    "leaves a Review active on indexing failure and abandons it",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const reviewInputs: ReviewerAgentInput[] = [];
        mkdirSync(join(root, ".git", "but-why", "BY-1", "task_review", "reviewer-sessions"), {
          recursive: true,
        });
        writeFileSync(
          join(root, ".git", "but-why", "BY-1", "task_review", "reviewer-sessions", "bad.jsonl"),
          "not a session",
        );

        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { reviewerAgentRuntime: reviewerThatPasses(reviewInputs) },
        );
        expect(submitted.status).toBe(1);
        const failed = JSON.parse(submitted.stdout) as {
          readonly error: {
            readonly code: string;
            readonly reviewId: string;
            readonly operation?: string;
          };
        };
        expect(failed.error.code).toBe("review_cleanup_pending");
        expect(failed.error.operation).toBe("index_task_review_transcripts");

        // Abandonment retries cleanup and transcript indexing; the broken session
        // storage blocks completion, so the Review stays active for repair.
        const abandoned = yield* runByInProcessEffect(
          root,
          [
            "--json",
            "task-review",
            "abandon",
            failed.error.reviewId,
            "--reason",
            "Cleanup after indexing failure",
          ],
          secondNow,
        );
        expect(abandoned.status).toBe(1);
        expect(JSON.parse(abandoned.stdout)).toMatchObject({
          error: { code: "task_review_cleanup_failed", status: "cleanup_failed" },
        });

        const shown = yield* runByInProcessEffect(root, [
          "--json",
          "task-review",
          "show",
          failed.error.reviewId,
        ]);
        expect(shown.status).toBe(0);
        const reviewShow = JSON.parse(shown.stdout) as {
          readonly review: {
            readonly state: string;
            readonly outcome: string | null;
            readonly completionFailure?: {
              readonly operationName: string;
              readonly errorMessage: string;
            };
          };
          readonly nextAction?: string;
        };
        expect(reviewShow.review.state).toBe("running");
        expect(reviewShow.review.outcome).toBeNull();
        expect(reviewShow.review.completionFailure).toMatchObject({
          operationName: "abandon_task_review_transcripts",
        });
        expect(reviewShow.nextAction).toContain("Abandon with");

        // A New Task with an Active Review suggests abandonment, not submission.
        const taskShown = yield* runByInProcessEffect(root, ["--json", "task", "show", "BY-1"]);
        expect(taskShown.status).toBe(0);
        const taskShow = JSON.parse(taskShown.stdout) as { readonly nextAction?: string };
        expect(taskShow.nextAction).toContain("Active Task Review");
        expect(taskShow.nextAction).toContain("by task-review abandon");

        // After the broken session storage is repaired, abandonment succeeds and
        // reports a fresh-submission recovery action.
        rmSync(join(root, ".git", "but-why", "BY-1", "task_review", "reviewer-sessions"), {
          recursive: true,
          force: true,
        });
        const recovered = yield* runByInProcessEffect(
          root,
          [
            "--json",
            "task-review",
            "abandon",
            failed.error.reviewId,
            "--reason",
            "Repair after indexing failure",
          ],
          secondNow,
        );
        expect(recovered.status).toBe(0);
        expect(JSON.parse(recovered.stdout)).toMatchObject({
          status: "abandoned",
          nextAction: "Run `by task submit BY-1` to start a fresh Task Review.",
        });
      }),
    60_000,
  );

  it.effect(
    "shows recovery actions for a completed Tooling Failure Review",
    () =>
      Effect.gen(function* () {
        const root = yield* createInitializedTask();
        const failing: ReviewerAgentRuntime = {
          review: () =>
            Effect.sync(
              (): ReviewerAgentResult => ({
                ok: false,
                failure: new SandcastleToolingFailed({
                  operationName: "run_reviewer_agent",
                  message: "reviewer process failed",
                }),
                sessionUsability: "unknown",
                attempts: 1,
                stdout: "",
              }),
            ),
        };
        const submitted = yield* runByInProcessEffect(
          root,
          ["--json", "task", "submit", "BY-1"],
          firstNow,
          { reviewerAgentRuntime: failing },
        );
        expect(submitted.status).toBe(0);
        const result = JSON.parse(submitted.stdout) as {
          readonly review: { readonly id: string; readonly outcome: string };
        };
        expect(result.review.outcome).toBe("tooling_failed");

        const shown = yield* runByInProcessEffect(root, [
          "--json",
          "task-review",
          "show",
          result.review.id,
        ]);
        expect(shown.status).toBe(0);
        const reviewShow = JSON.parse(shown.stdout) as {
          readonly review: { readonly state: string; readonly outcome: string };
          readonly nextAction?: string;
        };
        expect(reviewShow.review.state).toBe("complete");
        expect(reviewShow.review.outcome).toBe("tooling_failed");
        expect(reviewShow.nextAction).toContain("by task submit BY-1");

        const listed = yield* runByInProcessEffect(root, ["--json", "task", "reviews", "BY-1"]);
        expect(listed.status).toBe(0);
        const history = JSON.parse(listed.stdout) as { readonly nextAction?: string };
        expect(history.nextAction).toContain("by task submit BY-1");
      }),
    60_000,
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
