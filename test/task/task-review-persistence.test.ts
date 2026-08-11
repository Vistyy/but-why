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
      yield* reviews.complete({ reviewId: "review-first", findings: [], now });
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
          toolingFailure: { operation: "confirm_task_review_proposal" },
        },
      });
    }),
  ),
);
