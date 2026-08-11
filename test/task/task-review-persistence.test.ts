import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const now = "2026-08-11T12:00:00.000Z";
const later = "2026-08-11T12:05:00.000Z";
const policy = {
  id: "task_advisory_review" as const,
  version: 1 as const,
  agentProfile: "review",
  profileScope: "global" as const,
  instructions: taskReviewBuiltInInstructions,
};

it.scoped(
  "captures exact Task Review proposal and dependency evidence with one Active Review",
  () =>
    withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const reviews = yield* openSqliteTaskReviewPersistence();
        yield* tasks.createTask({ title: "Dependency", description: "Observed dependency", now });
        yield* tasks.createTask({
          title: "Proposal",
          description: "Exact description",
          dependsOn: [publicTaskId("BY-1")],
          now,
        });
        const admitted = yield* reviews.admit({
          reviewId: "review-1",
          taskId: publicTaskId("BY-2"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          workspacePath: "/tmp/review-1",
          now,
        });
        expect(admitted).toMatchObject({
          ok: true,
          proposal: {
            title: "Proposal",
            description: "Exact description",
            dependencyIds: ["BY-1"],
          },
          dependencyEvidence: [
            { id: "BY-1", title: "Dependency", description: "Observed dependency", state: "new" },
          ],
        });
        expect(
          yield* reviews.admit({
            reviewId: "review-2",
            taskId: publicTaskId("BY-2"),
            policy,
            baseRef: "refs/heads/main",
            baseCommit: "a".repeat(40),
            workspacePath: "/tmp/review-2",
            now,
          }),
        ).toEqual({ ok: false, code: "active_task_review", reviewId: "review-1" });
      }),
    ),
);

it.scoped("selects the latest Review deterministically when creation times match", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-first",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-first",
        now,
      });
      yield* reviews.recordCleanup("review-first", "removed", now);
      yield* reviews.complete({
        reviewId: "review-first",
        findings: [
          {
            title: "Finding",
            description: "Description",
            evidence: "Evidence",
            files: [],
            artifactRefs: [],
          },
        ],
        now,
      });
      yield* reviews.admit({
        reviewId: "review-second",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "b".repeat(40),
        workspacePath: "/tmp/review-second",
        now,
      });

      expect(yield* reviews.getLatestForTask(publicTaskId("BY-1"))).toMatchObject({
        id: "review-second",
        state: "running",
      });
    }),
  ),
);

it.scoped("atomically approves only a passing exact Task Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Approved", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-passed",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-passed",
        now,
      });
      expect(yield* tasks.approveTask({ taskId: publicTaskId("BY-1"), now })).toEqual({
        ok: false,
        code: "active_task_review",
        reviewId: "review-passed",
      });
      yield* reviews.recordCleanup("review-passed", "removed", later);

      const completed = yield* reviews.complete({
        reviewId: "review-passed",
        findings: [],
        now: later,
      });

      expect(completed).toMatchObject({
        ok: true,
        outcome: "passed",
        review: { outcome: "passed" },
        task: { id: "BY-1", state: "todo" },
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "todo" });
      expect(
        yield* reviews.complete({ reviewId: "review-passed", findings: [], now: later }),
      ).toEqual({ ok: false, code: "task_review_not_active" });
    }),
  ),
);

it.scoped("leaves Finding-blocked and tooling-failed Tasks New", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      for (const [sequence, completion] of [
        {
          findings: [
            {
              title: "Finding",
              description: "Description",
              evidence: "Evidence",
              files: [],
              artifactRefs: [],
            },
          ],
        },
        {
          findings: [],
          toolingFailure: { operation: "run_task_review", message: "Reviewer failed." },
        },
      ].entries()) {
        const taskId = publicTaskId(`BY-${sequence + 1}`);
        const reviewId = `review-${sequence + 1}`;
        yield* tasks.createTask({ title: `Proposal ${sequence + 1}`, description: "Exact", now });
        yield* reviews.admit({
          reviewId,
          taskId,
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          workspacePath: `/tmp/${reviewId}`,
          now,
        });
        yield* reviews.recordCleanup(reviewId, "removed", later);
        const completed = yield* reviews.complete({ reviewId, ...completion, now: later });
        expect(completed).toMatchObject({
          ok: true,
          outcome: reviewId === "review-1" ? "blocked" : "tooling_failed",
        });
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ state: "new" });
      }
    }),
  ),
);

it.scoped("records the exact non-approval reason when Task state changes during review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-cancelled",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-cancelled",
        now,
      });
      yield* tasks.cancelTask({ taskId: publicTaskId("BY-1"), reason: "Superseded", now: later });
      yield* reviews.recordCleanup("review-cancelled", "removed", later);

      const completed = yield* reviews.complete({
        reviewId: "review-cancelled",
        findings: [],
        now: later,
      });

      expect(completed).toMatchObject({
        ok: true,
        outcome: "tooling_failed",
        review: {
          outcome: "tooling_failed",
          toolingFailure: {
            operation: "confirm_task_review_task_state",
            message: "Task state changed from new to cancelled during review.",
          },
        },
      });
    }),
  ),
);

it.scoped("returns the exact abandonment reason to a stale Task Submission completion", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-abandoned",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-abandoned",
        now,
      });
      yield* reviews.recordCleanup("review-abandoned", "removed", later);
      yield* reviews.abandon("review-abandoned", "Reviewer process stopped", later);

      const staleCompletion = yield* reviews.complete({
        reviewId: "review-abandoned",
        findings: [],
        now: later,
      });

      expect(staleCompletion).toMatchObject({
        ok: true,
        outcome: "tooling_failed",
        review: {
          outcome: "tooling_failed",
          toolingFailure: {
            operation: "task_review_abandoned",
            message: "Reviewer process stopped",
          },
        },
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ state: "new" });

      yield* tasks.createTask({ title: "Completed first", description: "Exact", now });
      yield* reviews.admit({
        reviewId: "review-completed-first",
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-completed-first",
        now,
      });
      yield* reviews.recordCleanup("review-completed-first", "removed", later);
      yield* reviews.complete({
        reviewId: "review-completed-first",
        findings: [],
        toolingFailure: { operation: "run_task_review", message: "Reviewer failed" },
        now: later,
      });
      expect(
        yield* reviews.abandon("review-completed-first", "Too late to abandon", later),
      ).toEqual({ ok: false, code: "task_review_not_active" });
    }),
  ),
);

it.scoped("finalizes a concurrently changed proposal as tooling failed and retains Findings", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Before", now });
      const admitted = yield* reviews.admit({
        reviewId: "review-stale",
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "b".repeat(40),
        workspacePath: "/tmp/review-stale",
        now,
      });
      expect(admitted.ok).toBe(true);
      yield* tasks.updateTaskContext({
        taskId: publicTaskId("BY-1"),
        description: "After",
        now: later,
      });
      yield* reviews.recordCleanup("review-stale", "removed", later);
      const completed = yield* reviews.complete({
        reviewId: "review-stale",
        findings: [
          {
            title: "Finding",
            description: "Description",
            evidence: "Evidence",
            files: [],
            artifactRefs: [],
          },
        ],
        now: later,
      });
      expect(completed).toMatchObject({
        ok: true,
        review: {
          state: "complete",
          outcome: "tooling_failed",
          findings: [{ title: "Finding", artifactRefs: [] }],
          toolingFailure: { operation: "confirm_task_review_context" },
        },
      });
    }),
  ),
);
