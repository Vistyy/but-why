import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const now = "2026-08-11T12:00:00.000Z";
const policy = {
  profile: {
    agentProfile: "review",
    scope: "global" as const,
    profile: { agentRuntime: "pi" as const },
  },
  builtInInstructions: taskReviewBuiltInInstructions,
  guidance: null,
};

it.scoped("allocates ordered numeric Task Review IDs and enforces one Active Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Dependency", description: "Observed dependency", now });
      yield* tasks.createTask({
        title: "Proposal",
        description: "Exact description",
        dependsOn: [publicTaskId("BY-1")],
        now,
      });

      const admitted = yield* reviews.admit({
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      expect(admitted).toMatchObject({
        ok: true,
        review: { id: 1, state: "running", outcome: null },
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
          taskId: publicTaskId("BY-2"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          now,
        }),
      ).toEqual({ ok: false, code: "active_task_review", reviewId: 1 });
    }),
  ),
);

it.scoped("orders immutable Task Review history by its SQLite ID", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Proposal", description: "Exact", now });

      const first = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        now,
      });
      if (!first.ok) throw new Error(`Task Review admission failed: ${first.code}`);
      yield* reviews.recordCleanup(first.review.id, "removed", now);
      const blocked = yield* reviews.complete({
        reviewId: first.review.id,
        findings: [
          {
            title: "Clarify scope",
            description: "The proposal is incomplete.",
            evidence: "Missing supported outcome.",
            files: [],
          },
        ],
        now,
      });
      expect(blocked).toMatchObject({ ok: true, outcome: "blocked" });

      const second = yield* reviews.admit({
        taskId: publicTaskId("BY-1"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "b".repeat(40),
        now,
      });
      if (!second.ok) throw new Error(`Task Review admission failed: ${second.code}`);
      expect(second.review.id).toBe(2);
      yield* reviews.recordCleanup(second.review.id, "removed", now);
      const passed = yield* reviews.complete({ reviewId: second.review.id, findings: [], now });
      expect(passed).toMatchObject({ ok: true, outcome: "passed" });

      expect((yield* reviews.listForTask(publicTaskId("BY-1"))).map((review) => review.id)).toEqual(
        [1, 2],
      );
      expect(yield* reviews.getLatestForTask(publicTaskId("BY-1"))).toMatchObject({
        id: 2,
        outcome: "passed",
      });
    }),
  ),
);
