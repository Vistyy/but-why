import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import type { TaskReviewPolicySnapshot } from "../../src/task/taskReview.js";
import { withTemporaryRepositoryState } from "../support/repository.js";
import { transitionTaskToTodo } from "../support/taskApproval.js";

const firstNow = "2026-08-01T09:00:00.000Z";
const secondNow = "2026-08-01T09:05:00.000Z";
const thirdNow = "2026-08-01T09:10:00.000Z";
const baseCommit = "abcdef0123456789abcdef0123456789abcdef01";

const policy: TaskReviewPolicySnapshot = {
  version: 1,
  instructions: "Review the Task proposal against repository evidence.",
  instructionsSource: "built_in",
  profile: { agentProfile: "task-reviewer", scope: "repo" },
};

const createTask = (tasks: TaskPersistence, title: string, now: string) =>
  Effect.gen(function* () {
    const created = yield* tasks.createTask({ title, description: `Description: ${title}`, now });
    if (!created.ok) throw new Error(created.code);
    return { id: publicTaskId(created.task.id) };
  });

it.scoped("admits a Task Review and captures the exact proposal and workspace setup", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const first = yield* createTask(tasks, "Prerequisite", firstNow);
      const second = yield* createTask(tasks, "Admitted", firstNow);
      const added = yield* tasks.editTaskDependencies({
        taskId: second.id,
        operation: "replace",
        prerequisiteTaskIds: [first.id],
      });
      if (!added.ok) throw new Error(added.code);

      const started = yield* reviews.startOrReuse({
        taskId: second.id,
        baseCommit,
        policy,
        reviewId: "review-1",
        workspaceSetup: {
          tempRefName: "refs/but-why/task-reviews/review-1/review",
          worktreePath: "/tmp/worktrees/task-reviews-review-1",
        },
        now: firstNow,
      });

      expect(started).toMatchObject({
        ok: true,
        reused: false,
        reviewId: "review-1",
        proposal: {
          title: "Admitted",
          description: "Description: Admitted",
          dependencies: [{ taskId: first.id, title: "Prerequisite", state: "new" }],
        },
      });

      const active = yield* reviews.getActiveForTask(second.id);
      expect(active).toEqual({ taskId: second.id, reviewId: "review-1" });

      const recorded = yield* reviews.getReviewById("review-1");
      expect(recorded).toMatchObject({
        id: "review-1",
        taskId: second.id,
        baseCommit,
        state: "running",
        outcome: null,
        createdAt: firstNow,
        proposal: {
          title: "Admitted",
          description: "Description: Admitted",
          dependencies: [{ taskId: first.id, title: "Prerequisite", state: "new" }],
        },
        policy,
      });

      const context = yield* reviews.getAbandonmentContext("review-1");
      expect(context).toMatchObject({
        reviewId: "review-1",
        taskId: second.id,
        submittedSha: baseCommit,
        tempRefName: "refs/but-why/task-reviews/review-1/review",
        worktreePath: "/tmp/worktrees/task-reviews-review-1",
        cleanupWorktree: "not_created",
        cleanupTempRef: "not_created",
      });
    }),
  ),
);

it.scoped("completes a passing Task Review atomically and moves the Task to Todo", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Pass", firstNow);
      const started = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-pass",
        now: firstNow,
      });
      if (!started.ok || started.reused) throw new Error("start failed");

      const completed = yield* reviews.complete({
        reviewId: "review-pass",
        outcome: "passed",
        now: secondNow,
      });

      expect(completed.ok).toBe(true);
      if (!completed.ok) throw new Error(completed.code);
      expect(completed.task).toEqual({ id: task.id, state: "todo" });
      expect(completed.review.state).toBe("complete");
      expect(completed.review.outcome).toBe("passed");
      expect(completed.review.updatedAt).toBe(secondNow);
      expect(yield* reviews.getActiveForTask(task.id)).toBeUndefined();
      expect(yield* tasks.getTaskById(task.id)).toMatchObject({ state: "todo" });
    }),
  ),
);

it.scoped("records Findings and leaves the Task New for a blocked Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Blocked", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-blocked",
        now: firstNow,
      });

      const completed = yield* reviews.complete({
        reviewId: "review-blocked",
        outcome: "blocked",
        findings: [
          {
            id: "review-blocked-F1",
            reviewId: "review-blocked",
            title: "Missing verification",
            description: "No evidence of the bounded result.",
            evidence: "command: none\nexitCode: 0",
            files: [],
          },
        ],
        now: secondNow,
      });

      expect(completed.ok).toBe(true);
      if (!completed.ok) throw new Error(completed.code);
      expect(completed.task.state).toBe("new");
      const findings = yield* reviews.listFindings("review-blocked");
      expect(findings).toEqual([
        {
          id: "review-blocked-F1",
          reviewId: "review-blocked",
          title: "Missing verification",
          description: "No evidence of the bounded result.",
          evidence: "command: none\nexitCode: 0",
          files: [],
          createdAt: secondNow,
        },
      ]);
    }),
  ),
);

it.scoped("records Tooling Failure and leaves the Task New", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Tooling", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-tooling",
        now: firstNow,
      });

      yield* reviews.recordToolingFailure({
        reviewId: "review-tooling",
        errorKind: "infrastructure_tooling_failed",
        operationName: "run_task_reviewer_agent",
        errorMessage: "Agent launch failed.",
        now: secondNow,
      });
      const completed = yield* reviews.complete({
        reviewId: "review-tooling",
        outcome: "tooling_failed",
        now: thirdNow,
      });

      expect(completed.ok).toBe(true);
      if (!completed.ok) throw new Error(completed.code);
      expect(completed.task.state).toBe("new");
      const failures = yield* reviews.listToolingFailures("review-tooling");
      expect(failures).toEqual([
        {
          sequence: 1,
          reviewId: "review-tooling",
          errorKind: "infrastructure_tooling_failed",
          operationName: "run_task_reviewer_agent",
          errorMessage: "Agent launch failed.",
          createdAt: secondNow,
        },
      ]);
    }),
  ),
);

it.scoped("reuses the newest matching completed Review and returns before repository work", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const prerequisite = yield* createTask(tasks, "Prerequisite", firstNow);
      const task = yield* createTask(tasks, "Reuse", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-first",
        now: firstNow,
      });
      yield* reviews.complete({ reviewId: "review-first", outcome: "blocked", now: secondNow });

      // Change the proposal so the prior blocked Review no longer matches.
      const edited = yield* tasks.editTaskDependencies({
        taskId: task.id,
        operation: "replace",
        prerequisiteTaskIds: [prerequisite.id],
      });
      if (!edited.ok) throw new Error(edited.code);

      const second = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-second",
        now: secondNow,
      });
      expect(second).toEqual({
        ok: true,
        reused: false,
        reviewId: "review-second",
        proposal: {
          title: "Reuse",
          description: "Description: Reuse",
          dependencies: [{ taskId: prerequisite.id, title: "Prerequisite", state: "new" }],
        },
      });
      yield* reviews.complete({ reviewId: "review-second", outcome: "blocked", now: thirdNow });

      const checked = yield* reviews.checkReuse(task.id);
      expect(checked).toEqual({ reused: true, reviewId: "review-second", outcome: "blocked" });

      const started = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-never-used",
        now: thirdNow,
      });
      expect(started).toEqual({
        ok: true,
        reused: true,
        reviewId: "review-second",
        outcome: "blocked",
      });
    }),
  ),
);

it.scoped("rejects reuse for a changed proposal and starts a new Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Original", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-original",
        now: firstNow,
      });
      yield* reviews.complete({ reviewId: "review-original", outcome: "blocked", now: secondNow });

      const updated = yield* tasks.updateTaskContext({
        taskId: task.id,
        title: "Changed title",
        description: "Changed description",
        now: thirdNow,
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) throw new Error(updated.code);

      const started = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-changed",
        now: thirdNow,
      });
      expect(started).toMatchObject({ ok: true, reused: false, reviewId: "review-changed" });
      if (!started.ok || started.reused) throw new Error("start failed");
      expect(started.proposal.title).toBe("Changed title");
    }),
  ),
);

it.scoped("enforces one active Review per Task and rejects mutation and cancellation", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Locked", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-active",
        now: firstNow,
      });

      const second = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-second",
        now: secondNow,
      });
      expect(second).toEqual({ ok: false, code: "review_active", reviewId: "review-active" });

      expect(
        yield* tasks.updateTaskContext({
          taskId: task.id,
          title: "Blocked title",
          description: "Blocked description",
          now: secondNow,
        }),
      ).toEqual({ ok: false, code: "task_review_active" });

      expect(
        yield* tasks.editTaskDependencies({
          taskId: task.id,
          operation: "clear",
          prerequisiteTaskIds: [],
        }),
      ).toEqual({ ok: false, code: "task_review_active" });

      expect(
        yield* tasks.cancelTask({ taskId: task.id, reason: "Blocked cancel", now: secondNow }),
      ).toEqual({ ok: false, code: "task_review_active" });
    }),
  ),
);

it.scoped("compare-and-set completion rejects a second completion and unknown reviews", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "CAS", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-cas",
        now: firstNow,
      });
      yield* reviews.complete({ reviewId: "review-cas", outcome: "blocked", now: secondNow });

      const second = yield* reviews.complete({
        reviewId: "review-cas",
        outcome: "passed",
        now: thirdNow,
      });
      expect(second).toEqual({ ok: false, code: "review_not_active" });

      const unknown = yield* reviews.complete({
        reviewId: "review-unknown",
        outcome: "passed",
        now: thirdNow,
      });
      expect(unknown).toEqual({ ok: false, code: "review_not_found" });
    }),
  ),
);

it.scoped("rejects admission for non-New, linked, and unknown Tasks", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Stateful", firstNow);
      yield* transitionTaskToTodo(task.id, firstNow);

      const nonNew = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-todo",
        now: secondNow,
      });
      expect(nonNew).toEqual({
        ok: false,
        code: "invalid_task_state",
        state: "todo",
      });

      const linked = yield* reviews.startOrReuse({
        taskId: publicTaskId("BY-404"),
        baseCommit,
        policy,
        reviewId: "review-missing",
        now: secondNow,
      });
      expect(linked).toEqual({ ok: false, code: "task_not_found" });
    }),
  ),
);

it.scoped("retains complete Review history and rejects malformed persisted values", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const firstTask = yield* createTask(tasks, "History A", firstNow);
      const secondTask = yield* createTask(tasks, "History B", firstNow);
      yield* reviews.startOrReuse({
        taskId: firstTask.id,
        baseCommit,
        policy,
        reviewId: "review-history-1",
        now: firstNow,
      });
      yield* reviews.complete({
        reviewId: "review-history-1",
        outcome: "blocked",
        now: secondNow,
      });
      yield* reviews.startOrReuse({
        taskId: secondTask.id,
        baseCommit,
        policy,
        reviewId: "review-history-2",
        now: secondNow,
      });
      yield* reviews.complete({ reviewId: "review-history-2", outcome: "passed", now: thirdNow });

      const history = yield* reviews.listReviewsForTask(firstTask.id);
      expect(history.map((review) => review.id)).toEqual(["review-history-1"]);
      expect(history.map((review) => review.outcome)).toEqual(["blocked"]);
      const secondHistory = yield* reviews.listReviewsForTask(secondTask.id);
      expect(secondHistory.map((review) => review.id)).toEqual(["review-history-2"]);

      const latest = yield* reviews.latestCompletedReviewForTask(secondTask.id);
      expect(latest?.id).toBe("review-history-2");

      const repository = yield* RepositorySql;
      yield* repository.operation(
        "corrupt Task Review proposal",
        (sql) =>
          sql`UPDATE task_reviews SET proposal_snapshot = 'not-json' WHERE id = 'review-history-1'`,
      );
      const malformed = yield* Effect.isFailure(reviews.getReviewById("review-history-1"));
      expect(malformed).toBe(true);
    }),
  ),
);
