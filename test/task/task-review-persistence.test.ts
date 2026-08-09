import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
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
          dependencies: [
            {
              taskId: first.id,
              title: "Prerequisite",
              description: "Description: Prerequisite",
              state: "new",
              dependencyIds: [],
            },
          ],
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
          dependencies: [
            {
              taskId: first.id,
              title: "Prerequisite",
              description: "Description: Prerequisite",
              state: "new",
              dependencyIds: [],
            },
          ],
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

it.scoped("captures each direct dependency's full context and nested dependency IDs", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const root = yield* createTask(tasks, "Root prerequisite", firstNow);
      const middle = yield* createTask(tasks, "Middle prerequisite", firstNow);
      const edited = yield* tasks.editTaskDependencies({
        taskId: middle.id,
        operation: "replace",
        prerequisiteTaskIds: [root.id],
      });
      if (!edited.ok) throw new Error(edited.code);
      const subject = yield* createTask(tasks, "Dependent subject", firstNow);
      const added = yield* tasks.editTaskDependencies({
        taskId: subject.id,
        operation: "replace",
        prerequisiteTaskIds: [middle.id],
      });
      if (!added.ok) throw new Error(added.code);

      const started = yield* reviews.startOrReuse({
        taskId: subject.id,
        baseCommit,
        policy,
        reviewId: "review-dependencies",
        now: firstNow,
      });
      expect(started).toMatchObject({
        ok: true,
        reused: false,
        proposal: {
          dependencies: [
            {
              taskId: middle.id,
              title: "Middle prerequisite",
              description: "Description: Middle prerequisite",
              state: "new",
              dependencyIds: [root.id],
            },
          ],
        },
      });

      // The proposal round-trips through the persisted snapshot with the same evidence.
      const recorded = yield* reviews.getReviewById("review-dependencies");
      expect(recorded?.proposal.dependencies).toEqual([
        {
          taskId: middle.id,
          title: "Middle prerequisite",
          description: "Description: Middle prerequisite",
          state: "new",
          dependencyIds: [root.id],
        },
      ]);
    }),
  ),
);

it.scoped("clears a stored completion failure after successful completion or abandonment", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const completedTask = yield* createTask(tasks, "Recovered completion", firstNow);
      yield* reviews.startOrReuse({
        taskId: completedTask.id,
        baseCommit,
        policy,
        reviewId: "review-recovered-complete",
        now: firstNow,
      });
      yield* reviews.recordCompletionFailure({
        reviewId: "review-recovered-complete",
        operationName: "index_task_review_transcripts",
        errorMessage: "unreadable session",
        now: firstNow,
      });
      yield* reviews.complete({
        reviewId: "review-recovered-complete",
        outcome: "blocked",
        now: secondNow,
      });
      expect(yield* reviews.getCompletionFailure("review-recovered-complete")).toBeUndefined();

      const abandonedTask = yield* createTask(tasks, "Recovered abandonment", secondNow);
      yield* reviews.startOrReuse({
        taskId: abandonedTask.id,
        baseCommit,
        policy,
        reviewId: "review-recovered-abandon",
        now: secondNow,
      });
      yield* reviews.recordCompletionFailure({
        reviewId: "review-recovered-abandon",
        operationName: "index_task_review_transcripts",
        errorMessage: "unreadable session",
        now: secondNow,
      });
      yield* reviews.abandon({
        reviewId: "review-recovered-abandon",
        errorKind: "infrastructure_tooling_failed",
        operationName: "cleanup_disposable_workspace",
        errorMessage: "submission stopped",
        now: thirdNow,
      });
      expect(yield* reviews.getCompletionFailure("review-recovered-abandon")).toBeUndefined();
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
          dependencies: [
            {
              taskId: prerequisite.id,
              title: "Prerequisite",
              description: "Description: Prerequisite",
              state: "new",
              dependencyIds: [],
            },
          ],
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

it.scoped("applyReuse revalidates the exact proposal and review facts atomically", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Revalidate", firstNow);
      const started = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-revalidate",
        now: firstNow,
      });
      if (!started.ok || started.reused) throw new Error("start failed");
      yield* reviews.complete({
        reviewId: "review-revalidate",
        outcome: "blocked",
        now: secondNow,
      });

      // A mutation between the reuse fast-path and this transaction changes the
      // proposal, so applying the stale judgment must not approve the Task.
      const edited = yield* tasks.updateTaskContext({
        taskId: task.id,
        title: "Changed after reuse check",
        description: "Changed description",
        now: thirdNow,
      });
      expect(edited.ok).toBe(true);
      if (!edited.ok) throw new Error(edited.code);

      const applied = yield* reviews.applyReuse({
        reviewId: "review-revalidate",
        outcome: "blocked",
        now: thirdNow,
      });
      expect(applied).toEqual({ ok: false, code: "task_state_changed" });
      expect(yield* tasks.getTaskById(task.id)).toMatchObject({ state: "new" });

      // A running Review cannot be applied, and a non-matching outcome cannot be applied.
      const running = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-running",
        now: thirdNow,
      });
      if (!running.ok || running.reused) throw new Error("start failed");
      expect(
        yield* reviews.applyReuse({
          reviewId: "review-running",
          outcome: "blocked",
          now: thirdNow,
        }),
      ).toEqual({ ok: false, code: "task_state_changed" });
      expect(
        yield* reviews.applyReuse({
          reviewId: "review-revalidate",
          outcome: "passed",
          now: thirdNow,
        }),
      ).toEqual({ ok: false, code: "task_state_changed" });
    }),
  ),
);

it.scoped(
  "applyReuse reports the post-update Task state for blocked reuse and refuses stale passed reuse",
  () =>
    withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const reviews = yield* openSqliteTaskReviewPersistence();
        const task = yield* createTask(tasks, "Applied state", firstNow);
        yield* reviews.startOrReuse({
          taskId: task.id,
          baseCommit,
          policy,
          reviewId: "review-blocked-state",
          now: firstNow,
        });
        yield* reviews.complete({
          reviewId: "review-blocked-state",
          outcome: "blocked",
          now: secondNow,
        });
        expect(
          yield* reviews.applyReuse({
            reviewId: "review-blocked-state",
            outcome: "blocked",
            now: secondNow,
          }),
        ).toEqual({ ok: true, task: { id: task.id, state: "new" } });
        expect(yield* tasks.getTaskById(task.id)).toMatchObject({ state: "new" });

        // A passing Review already moved the Task to Todo at completion, so a
        // later reuse cannot apply it again to a still-New Task.
        const secondTask = yield* createTask(tasks, "Applied passed state", secondNow);
        yield* reviews.startOrReuse({
          taskId: secondTask.id,
          baseCommit,
          policy,
          reviewId: "review-passed-state",
          now: secondNow,
        });
        yield* reviews.complete({
          reviewId: "review-passed-state",
          outcome: "passed",
          now: thirdNow,
        });
        expect(yield* tasks.getTaskById(secondTask.id)).toMatchObject({ state: "todo" });
        expect(
          yield* reviews.applyReuse({
            reviewId: "review-passed-state",
            outcome: "passed",
            now: thirdNow,
          }),
        ).toEqual({ ok: false, code: "task_state_changed" });
      }),
    ),
);

it.scoped("latestApplicableReviewForTask skips Tooling Failure and returns the prior outcome", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Applicable prior", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-prior",
        now: firstNow,
      });
      yield* reviews.complete({ reviewId: "review-prior", outcome: "blocked", now: secondNow });

      // Change the proposal so a newer Review can be created on the same Task.
      const edited = yield* tasks.updateTaskContext({
        taskId: task.id,
        title: "Newer proposal",
        description: "Newer description",
        now: secondNow,
      });
      expect(edited.ok).toBe(true);
      if (!edited.ok) throw new Error(edited.code);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-tooling-newer",
        now: secondNow,
      });
      yield* reviews.complete({
        reviewId: "review-tooling-newer",
        outcome: "tooling_failed",
        now: thirdNow,
      });

      const latest = yield* reviews.latestCompletedReviewForTask(task.id);
      expect(latest?.id).toBe("review-tooling-newer");
      const applicable = yield* reviews.latestApplicableReviewForTask(task.id);
      expect(applicable?.id).toBe("review-prior");
      expect(applicable?.outcome).toBe("blocked");
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

it.scoped("completion requires the Active Review marker and rejects passing Findings", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const missingMarker = yield* createTask(tasks, "Missing marker", firstNow);
      yield* reviews.startOrReuse({
        taskId: missingMarker.id,
        baseCommit,
        policy,
        reviewId: "review-missing-marker",
        now: firstNow,
      });
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "remove Active Review marker",
        (sql) => sql`DELETE FROM active_task_reviews WHERE review_id = 'review-missing-marker'`,
      );
      const completed = yield* reviews.complete({
        reviewId: "review-missing-marker",
        outcome: "blocked",
        now: secondNow,
      });
      expect(completed).toEqual({ ok: false, code: "review_not_active" });
      expect(yield* tasks.getTaskById(missingMarker.id)).toMatchObject({ state: "new" });

      const passingFindings = yield* createTask(tasks, "Passing with findings", firstNow);
      yield* reviews.startOrReuse({
        taskId: passingFindings.id,
        baseCommit,
        policy,
        reviewId: "review-passing-findings",
        now: firstNow,
      });
      const rejected = yield* reviews.complete({
        reviewId: "review-passing-findings",
        outcome: "passed",
        findings: [
          {
            id: "review-passing-findings-F1",
            reviewId: "review-passing-findings",
            title: "Blocking finding",
            description: "A passing Review cannot retain Findings.",
            evidence: "command: none",
            files: [],
          },
        ],
        now: secondNow,
      });
      expect(rejected).toEqual({ ok: false, code: "passed_with_findings" });
      expect(yield* tasks.getTaskById(passingFindings.id)).toMatchObject({ state: "new" });
      expect(yield* reviews.getActiveForTask(passingFindings.id)).toBeDefined();
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

it.scoped("rejects reuse and reads when the stored proposal snapshot mismatches its key", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Snapshot key", firstNow);
      yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-snapshot-key",
        now: firstNow,
      });
      yield* reviews.complete({
        reviewId: "review-snapshot-key",
        outcome: "blocked",
        now: secondNow,
      });

      const repository = yield* RepositorySql;
      yield* repository.operation("corrupt proposal snapshot without its key", (sql) => {
        const proposal = {
          title: "Different snapshot title",
          description: "Description: Snapshot key",
          dependencies: [],
        };
        return sql`UPDATE task_reviews SET proposal_snapshot = ${JSON.stringify(proposal)}
            WHERE id = 'review-snapshot-key'`;
      });

      // Reads decode the proposal at the owning boundary and reject the mismatch.
      expect(yield* Effect.isFailure(reviews.getReviewById("review-snapshot-key"))).toBe(true);

      // Reuse fast paths decode the stored snapshot and verify it produces its
      // own key, so the mismatched Review is never treated as reusable.
      const checked = yield* reviews.checkReuse(task.id);
      expect(checked).toEqual({ reused: false });

      // The direct apply guard still rejects an inconsistent Review.
      const applied = yield* reviews.applyReuse({
        reviewId: "review-snapshot-key",
        outcome: "blocked",
        now: thirdNow,
      });
      expect(applied).toEqual({ ok: false, code: "task_state_changed" });
      expect(yield* tasks.getTaskById(task.id)).toMatchObject({ state: "new" });
    }),
  ),
);

it.scoped("completion rejects an Active marker bound to a different Task", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const first = yield* createTask(tasks, "Marker first", firstNow);
      const second = yield* createTask(tasks, "Marker second", firstNow);
      const unmarked = yield* createTask(tasks, "Marker unmarked", firstNow);
      yield* reviews.startOrReuse({
        taskId: first.id,
        baseCommit,
        policy,
        reviewId: "review-marker-first",
        now: firstNow,
      });
      yield* reviews.startOrReuse({
        taskId: second.id,
        baseCommit,
        policy,
        reviewId: "review-marker-second",
        now: firstNow,
      });

      // Bind the first Review's Active marker to a Task that owns no marker.
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "rebind Active marker to another Task",
        (sql) =>
          sql`UPDATE active_task_reviews SET task_id = ${unmarked.id}
            WHERE review_id = 'review-marker-first'`,
      );

      const completed = yield* reviews.complete({
        reviewId: "review-marker-first",
        outcome: "blocked",
        now: secondNow,
      });
      expect(completed).toEqual({ ok: false, code: "review_not_active" });
      expect(yield* tasks.getTaskById(first.id)).toMatchObject({ state: "new" });
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

it.scoped("rejects malformed persisted values at each owning boundary", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Decoded", firstNow);
      const started = yield* reviews.startOrReuse({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-decoded",
        workspaceSetup: {
          tempRefName: "refs/but-why/task-reviews/review-decoded/review",
          worktreePath: "/tmp/worktrees/review-decoded",
        },
        now: firstNow,
      });
      if (!started.ok || started.reused) throw new Error("start failed");
      yield* reviews.recordToolingFailure({
        reviewId: "review-decoded",
        errorKind: "infrastructure_tooling_failed",
        operationName: "run_task_reviewer_agent",
        errorMessage: "Agent launch failed.",
        now: secondNow,
      });
      yield* reviews.saveTaskReviewSession({
        taskId: task.id,
        producer: "task_review",
        fingerprint: "fingerprint-1",
        sessionReference: "session-1",
      });
      yield* reviews.recordTaskReviewTranscripts({
        taskId: task.id,
        transcripts: [
          {
            taskId: task.id,
            producer: "task_review",
            piSessionId: "session-1",
            filePath: "sessions/task_review.jsonl",
          },
        ],
      });

      const repository = yield* RepositorySql;

      // Migration CHECK constraints reject invalid Review state, outcome, and
      // workspace cleanup values before they can reach the decode boundary.
      expect(
        yield* Effect.isFailure(
          repository.operation(
            "corrupt Task Review state",
            (sql) => sql`UPDATE task_reviews SET state = 'banana' WHERE id = 'review-decoded'`,
          ),
        ),
      ).toBe(true);
      expect(
        yield* Effect.isFailure(
          repository.operation(
            "corrupt Task Review outcome",
            (sql) => sql`UPDATE task_reviews SET outcome = 'maybe' WHERE id = 'review-decoded'`,
          ),
        ),
      ).toBe(true);
      expect(
        yield* Effect.isFailure(
          repository.operation(
            "corrupt cleanup state",
            (sql) =>
              sql`UPDATE task_review_workspace_setups SET cleanup_worktree = 'partially' WHERE review_id = 'review-decoded'`,
          ),
        ),
      ).toBe(true);

      // Persisted workspace identifiers are decoded before abandonment cleanup.
      yield* repository.operation(
        "corrupt workspace submitted SHA",
        (sql) => sql`UPDATE task_reviews SET base_commit = '' WHERE id = 'review-decoded'`,
      );
      expect(yield* Effect.isFailure(reviews.getAbandonmentContext("review-decoded"))).toBe(true);
      yield* repository.operation(
        "restore workspace submitted SHA",
        (sql) =>
          sql`UPDATE task_reviews SET base_commit = ${baseCommit} WHERE id = 'review-decoded'`,
      );
      yield* repository.operation(
        "corrupt workspace temp ref",
        (sql) =>
          sql`UPDATE task_review_workspace_setups SET temp_ref_name = '' WHERE review_id = 'review-decoded'`,
      );
      expect(yield* Effect.isFailure(reviews.getAbandonmentContext("review-decoded"))).toBe(true);

      // Tooling Failure values are decoded at the owning boundary.
      yield* repository.operation(
        "corrupt Tooling Failure error kind",
        (sql) =>
          sql`UPDATE task_review_tooling_failures SET error_kind = '' WHERE review_id = 'review-decoded'`,
      );
      expect(yield* Effect.isFailure(reviews.listToolingFailures("review-decoded"))).toBe(true);

      // Finding core fields are decoded at the owning boundary.
      yield* repository.operation(
        "insert Finding",
        (sql) =>
          sql`
            INSERT INTO task_review_findings (
              id, review_id, title, description, evidence, files, created_at
            ) VALUES (
              'review-decoded-F1', 'review-decoded', 'Title', 'Description', 'Evidence',
              '[]', ${secondNow}
            )
          `,
      );
      yield* repository.operation(
        "corrupt Finding title",
        (sql) => sql`UPDATE task_review_findings SET title = '' WHERE review_id = 'review-decoded'`,
      );
      expect(yield* Effect.isFailure(reviews.listFindings("review-decoded"))).toBe(true);

      // Session and transcript records are decoded at the owning boundary.
      yield* repository.operation(
        "corrupt Session producer",
        (sql) => sql`UPDATE task_review_sessions SET producer = ' ' WHERE task_id = ${task.id}`,
      );
      expect(yield* Effect.isFailure(reviews.getTaskReviewSession(task.id, " "))).toBe(true);
      yield* repository.operation(
        "corrupt Transcript file path",
        (sql) => sql`UPDATE task_review_transcripts SET file_path = '' WHERE task_id = ${task.id}`,
      );
      expect(yield* Effect.isFailure(reviews.listTaskReviewTranscripts(task.id))).toBe(true);
    }),
  ),
);
