import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import type { TaskReviewPolicySnapshot } from "../../src/task/taskReview.js";
import type {
  CompleteTaskReviewInput,
  TaskReviewPersistence,
} from "../../src/task/taskReviewStore.js";
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

const blockingFindings = (reviewId: string) =>
  [
    {
      id: `${reviewId}-F1`,
      reviewId,
      title: "Blocking finding",
      description: "The Review found a blocking problem.",
      evidence: "Focused reviewer evidence.",
      files: [],
    },
  ] as const;

const createTask = (tasks: TaskPersistence, title: string, now: string) =>
  Effect.gen(function* () {
    const created = yield* tasks.createTask({ title, description: `Description: ${title}`, now });
    if (!created.ok) throw new Error(created.code);
    return { id: publicTaskId(created.task.id) };
  });

const recordRemovedWorkspace = (reviews: TaskReviewPersistence, reviewId: string, now: string) =>
  reviews.recordWorkspaceSetup({
    reviewId,
    tempRefName: `refs/but-why/task-reviews/${reviewId}/review`,
    submittedSha: baseCommit,
    worktreeHead: baseCommit,
    cleanupWorktree: "removed",
    cleanupTempRef: "removed",
    createdAt: now,
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

      const started = yield* reviews.start({
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
        reviewId: "review-1",
        proposal: {
          title: "Admitted",
          description: "Description: Admitted",
          dependencyIds: [first.id],
        },
        dependencyEvidence: [
          {
            taskId: first.id,
            title: "Prerequisite",
            description: "Description: Prerequisite",
            state: "new",
            dependencyIds: [],
          },
        ],
      });

      const active = yield* reviews.getActiveForTask(second.id);
      expect(active).toEqual({ taskId: second.id, reviewId: "review-1" });

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

      const started = yield* reviews.start({
        taskId: subject.id,
        baseCommit,
        policy,
        reviewId: "review-dependencies",
        now: firstNow,
      });
      expect(started).toMatchObject({
        ok: true,
        proposal: { dependencyIds: [middle.id] },
        dependencyEvidence: [
          {
            taskId: middle.id,
            title: "Middle prerequisite",
            description: "Description: Middle prerequisite",
            state: "new",
            dependencyIds: [root.id],
          },
        ],
      });
    }),
  ),
);

it.scoped("clears a stored completion failure after successful completion or abandonment", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const completedTask = yield* createTask(tasks, "Recovered completion", firstNow);
      yield* reviews.start({
        taskId: completedTask.id,
        baseCommit,
        policy,
        reviewId: "review-recovered-complete",
        now: firstNow,
      });
      yield* reviews.recordCompletionFailure({
        reviewId: "review-recovered-complete",
        operationName: "cleanup_disposable_workspace",
        errorMessage: "workspace removal failed",
        now: firstNow,
      });
      yield* recordRemovedWorkspace(reviews, "review-recovered-complete", secondNow);
      yield* reviews.complete({
        reviewId: "review-recovered-complete",
        outcome: "blocked",
        findings: blockingFindings("review-recovered-complete"),
        now: secondNow,
      });
      expect(yield* reviews.getCompletionFailure("review-recovered-complete")).toBeUndefined();

      const abandonedTask = yield* createTask(tasks, "Recovered abandonment", secondNow);
      yield* reviews.start({
        taskId: abandonedTask.id,
        baseCommit,
        policy,
        reviewId: "review-recovered-abandon",
        now: secondNow,
      });
      yield* reviews.recordCompletionFailure({
        reviewId: "review-recovered-abandon",
        operationName: "cleanup_disposable_workspace",
        errorMessage: "workspace removal failed",
        now: secondNow,
      });
      yield* reviews.abandon({
        reviewId: "review-recovered-abandon",
        cleanupWorktree: "removed",
        cleanupTempRef: "removed",
        errorKind: "infrastructure_tooling_failed",
        operationName: "cleanup_disposable_workspace",
        errorMessage: "submission stopped",
        now: thirdNow,
      });
      expect(yield* reviews.getCompletionFailure("review-recovered-abandon")).toBeUndefined();
    }),
  ),
);

it.scoped("completes a passing Task Review atomically and leaves the Task New", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Pass", firstNow);
      const started = yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-pass",
        now: firstNow,
      });
      if (!started.ok) throw new Error("start failed");

      const provisionalCompletion = yield* Effect.either(
        reviews.complete({
          reviewId: "review-pass",
          outcome: "passed",
          now: secondNow,
        }),
      );
      expect(provisionalCompletion).toMatchObject({
        _tag: "Left",
        left: { _tag: "RepositoryPersistedDataInvalid" },
      });
      expect(yield* reviews.getActiveForTask(task.id)).toEqual({
        taskId: task.id,
        reviewId: "review-pass",
      });

      yield* recordRemovedWorkspace(reviews, "review-pass", secondNow);
      const completed = yield* reviews.complete({
        reviewId: "review-pass",
        outcome: "passed",
        now: secondNow,
      });

      expect(completed.ok).toBe(true);
      if (!completed.ok) throw new Error(completed.code);
      expect(completed.task).toEqual({ id: task.id, state: "new" });
      expect(completed.review.state).toBe("complete");
      expect(completed.review.outcome).toBe("passed");
      expect(completed.review.updatedAt).toBe(secondNow);
      expect(yield* reviews.getActiveForTask(task.id)).toBeUndefined();
      expect(yield* tasks.getTaskById(task.id)).toMatchObject({ state: "new" });
    }),
  ),
);

it.scoped("rejects outcome evidence that conflicts with persisted Review evidence", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Conflicting evidence", firstNow);
      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-conflicting-evidence",
        now: firstNow,
      });
      yield* reviews.recordToolingFailure({
        reviewId: "review-conflicting-evidence",
        errorKind: "infrastructure_tooling_failed",
        operationName: "run_task_reviewer_agent",
        errorMessage: "Reviewer process failed.",
        now: secondNow,
      });
      yield* recordRemovedWorkspace(reviews, "review-conflicting-evidence", secondNow);

      const completion = yield* Effect.either(
        reviews.complete({
          reviewId: "review-conflicting-evidence",
          outcome: "passed",
          now: secondNow,
        }),
      );
      expect(completion).toMatchObject({
        _tag: "Left",
        left: { _tag: "RepositoryPersistedDataInvalid" },
      });
      expect(yield* reviews.getActiveForTask(task.id)).toBeDefined();
    }),
  ),
);

it.scoped("rejects abandonment when a running Review already has terminal evidence", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Conflicting abandonment evidence", firstNow);
      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-conflicting-abandonment",
        now: firstNow,
      });
      yield* reviews.recordToolingFailure({
        reviewId: "review-conflicting-abandonment",
        errorKind: "infrastructure_tooling_failed",
        operationName: "run_task_reviewer_agent",
        errorMessage: "Reviewer process failed.",
        now: secondNow,
      });

      const abandonment = yield* Effect.either(
        reviews.abandon({
          reviewId: "review-conflicting-abandonment",
          cleanupWorktree: "removed",
          cleanupTempRef: "removed",
          errorKind: "infrastructure_tooling_failed",
          operationName: "task_review_abandonment",
          errorMessage: "Submission process stopped.",
          now: thirdNow,
        }),
      );

      expect(abandonment).toMatchObject({
        _tag: "Left",
        left: { _tag: "RepositoryPersistedDataInvalid" },
      });
      expect(yield* reviews.getActiveForTask(task.id)).toBeDefined();
      expect(yield* reviews.listToolingFailures("review-conflicting-abandonment")).toHaveLength(1);
    }),
  ),
);

it.scoped(
  "rejects terminal transitions for a Review whose proposal no longer matches its Task",
  () =>
    withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const reviews = yield* openSqliteTaskReviewPersistence();
        const repository = yield* RepositorySql;

        for (const transition of ["complete", "abandon"] as const) {
          const reviewId = `review-changed-proposal-${transition}`;
          const task = yield* createTask(tasks, `Changed proposal ${transition}`, firstNow);
          yield* reviews.start({ taskId: task.id, baseCommit, policy, reviewId, now: firstNow });
          const changedProposal = JSON.stringify({
            title: `Different ${transition} proposal`,
            description: "A proposal that was not admitted.",
            dependencyIds: [],
          });
          yield* repository.operation(
            "replace running Task Review proposal",
            (sql) => sql`
            UPDATE task_reviews
            SET proposal_snapshot = ${changedProposal}, proposal_key = ${changedProposal}
            WHERE id = ${reviewId}
          `,
          );

          const result =
            transition === "complete"
              ? yield* Effect.either(
                  reviews.complete({ reviewId, outcome: "passed", now: secondNow }),
                )
              : yield* Effect.either(
                  reviews.abandon({
                    reviewId,
                    cleanupWorktree: "removed",
                    cleanupTempRef: "removed",
                    errorKind: "infrastructure_tooling_failed",
                    operationName: "task_review_abandonment",
                    errorMessage: "Submission process stopped.",
                    now: secondNow,
                  }),
                );

          expect(result).toMatchObject({
            _tag: "Left",
            left: { _tag: "RepositoryPersistedDataInvalid" },
          });
          expect(yield* reviews.getActiveForTask(task.id)).toBeDefined();
        }
      }),
    ),
);

it.scoped("rejects malformed relational evidence when reading the latest Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Malformed latest Review", firstNow);
      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-malformed-latest",
        now: firstNow,
      });
      yield* recordRemovedWorkspace(reviews, "review-malformed-latest", secondNow);
      yield* reviews.complete({
        reviewId: "review-malformed-latest",
        outcome: "passed",
        now: secondNow,
      });
      yield* reviews.recordToolingFailure({
        reviewId: "review-malformed-latest",
        errorKind: "infrastructure_tooling_failed",
        operationName: "late_corruption",
        errorMessage: "Contradictory evidence.",
        now: thirdNow,
      });

      const latest = yield* Effect.either(reviews.latestCompletedReviewForTask(task.id));
      expect(latest).toMatchObject({
        _tag: "Left",
        left: { _tag: "RepositoryPersistedDataInvalid" },
      });
    }),
  ),
);

it.scoped("selects the latest admitted Review when completion timestamps and IDs disagree", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Durable Review order", firstNow);

      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-z-older",
        now: firstNow,
      });
      yield* recordRemovedWorkspace(reviews, "review-z-older", firstNow);
      yield* reviews.complete({
        reviewId: "review-z-older",
        outcome: "blocked",
        findings: blockingFindings("review-z-older"),
        now: firstNow,
      });

      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-a-newer",
        now: firstNow,
      });
      expect(yield* reviews.inspectForTask(task.id)).toMatchObject({
        active: { reviewId: "review-a-newer" },
        latest: { id: "review-z-older", outcome: "blocked" },
      });
      yield* recordRemovedWorkspace(reviews, "review-a-newer", firstNow);
      yield* reviews.complete({ reviewId: "review-a-newer", outcome: "passed", now: firstNow });

      expect(yield* reviews.inspectForTask(task.id)).toMatchObject({
        latest: { id: "review-a-newer", outcome: "passed" },
      });
    }),
  ),
);

it.scoped("records Findings and leaves the Task New for a blocked Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Blocked", firstNow);
      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-blocked",
        now: firstNow,
      });

      yield* recordRemovedWorkspace(reviews, "review-blocked", secondNow);
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
      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-tooling",
        now: firstNow,
      });

      yield* recordRemovedWorkspace(reviews, "review-tooling", thirdNow);
      const completed = yield* reviews.complete({
        reviewId: "review-tooling",
        outcome: "tooling_failed",
        toolingFailure: {
          errorKind: "infrastructure_tooling_failed",
          operationName: "run_task_reviewer_agent",
          errorMessage: "Agent launch failed.",
        },
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
          createdAt: thirdNow,
        },
      ]);
    }),
  ),
);

it.scoped("keeps direct Task approval available when no Review is active", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Direct approval", firstNow);

      expect(yield* reviews.getActiveForTask(task.id)).toBeUndefined();
      expect(yield* tasks.approveTask({ taskId: task.id, now: secondNow })).toMatchObject({
        ok: true,
        changed: true,
        task: { id: task.id, state: "todo" },
      });
      expect(yield* reviews.latestCompletedReviewForTask(task.id)).toBeUndefined();
    }),
  ),
);

it.scoped("enforces one active Review per Task and rejects mutation and cancellation", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Locked", firstNow);
      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-active",
        now: firstNow,
      });

      const second = yield* reviews.start({
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

      expect(yield* tasks.approveTask({ taskId: task.id, now: secondNow })).toEqual({
        ok: false,
        code: "task_review_active",
      });

      expect(
        yield* tasks.cancelTask({ taskId: task.id, reason: "Blocked cancel", now: secondNow }),
      ).toEqual({ ok: false, code: "task_review_active" });

      // Simulate an out-of-band state change to establish that Change Start has
      // its own Active Review guard rather than relying on the Task being New.
      yield* transitionTaskToTodo(task.id, secondNow);
      const changes = yield* openSqliteChangeStartPersistence();
      expect(yield* changes.prepareTask(task.id)).toEqual({
        ok: false,
        code: "task_review_active",
        reviewId: "review-active",
      });
    }),
  ),
);

it.scoped("completion requires the Active Review marker and rejects passing Findings", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const missingMarker = yield* createTask(tasks, "Missing marker", firstNow);
      yield* reviews.start({
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
        findings: blockingFindings("review-missing-marker"),
        now: secondNow,
      });
      expect(completed).toEqual({ ok: false, code: "review_not_active" });
      expect(yield* tasks.getTaskById(missingMarker.id)).toMatchObject({ state: "new" });

      const passingFindings = yield* createTask(tasks, "Passing with findings", firstNow);
      yield* reviews.start({
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
      } as unknown as CompleteTaskReviewInput);
      expect(rejected).toEqual({ ok: false, code: "invalid_outcome_evidence" });
      expect(yield* tasks.getTaskById(passingFindings.id)).toMatchObject({ state: "new" });
      expect(yield* reviews.getActiveForTask(passingFindings.id)).toBeDefined();
    }),
  ),
);

it.scoped("rejects missing outcome evidence and preserves each Active Review", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      for (const [reviewId, outcome] of [
        ["review-blocked-without-findings", "blocked"],
        ["review-tooling-without-failure", "tooling_failed"],
      ] as const) {
        const task = yield* createTask(tasks, reviewId, firstNow);
        yield* reviews.start({ taskId: task.id, baseCommit, policy, reviewId, now: firstNow });
        const rejected = yield* reviews.complete({
          reviewId,
          outcome,
          now: secondNow,
        } as unknown as CompleteTaskReviewInput);
        expect(rejected).toEqual({ ok: false, code: "invalid_outcome_evidence" });
        expect(yield* reviews.getActiveByReviewId(reviewId)).toBeDefined();
      }
    }),
  ),
);

it.scoped("rejects non-passing completion after the Task leaves New", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      for (const [reviewId, completion] of [
        [
          "review-blocked-task-changed",
          { outcome: "blocked", findings: blockingFindings("review-blocked-task-changed") },
        ],
        [
          "review-tooling-task-changed",
          {
            outcome: "tooling_failed",
            toolingFailure: {
              errorKind: "infrastructure_tooling_failed",
              operationName: "run_task_reviewer_agent",
              errorMessage: "reviewer failed",
            },
          },
        ],
      ] as const) {
        const task = yield* createTask(tasks, reviewId, firstNow);
        yield* reviews.start({ taskId: task.id, baseCommit, policy, reviewId, now: firstNow });
        yield* transitionTaskToTodo(task.id, secondNow);
        const rejected = yield* reviews.complete({
          reviewId,
          ...completion,
          now: thirdNow,
        });
        expect(rejected).toEqual({ ok: false, code: "task_state_changed" });
        if (reviewId === "review-blocked-task-changed") {
          const abandoned = yield* Effect.either(
            reviews.abandon({
              reviewId,
              cleanupWorktree: "removed",
              cleanupTempRef: "removed",
              errorKind: "infrastructure_tooling_failed",
              operationName: "task_review_abandonment",
              errorMessage: "Submission process stopped",
              now: thirdNow,
            }),
          );
          expect(abandoned).toMatchObject({
            _tag: "Left",
            left: { _tag: "RepositoryPersistedDataInvalid" },
          });
        }
        expect(yield* reviews.getActiveByReviewId(reviewId)).toBeDefined();
      }
    }),
  ),
);

it.scoped("compare-and-set completion rejects a second completion and unknown reviews", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "CAS", firstNow);
      yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-cas",
        now: firstNow,
      });
      yield* recordRemovedWorkspace(reviews, "review-cas", secondNow);
      yield* reviews.complete({
        reviewId: "review-cas",
        outcome: "blocked",
        findings: blockingFindings("review-cas"),
        now: secondNow,
      });

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

it.scoped("completion rejects an Active marker bound to a different Task", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const first = yield* createTask(tasks, "Marker first", firstNow);
      const second = yield* createTask(tasks, "Marker second", firstNow);
      const unmarked = yield* createTask(tasks, "Marker unmarked", firstNow);
      yield* reviews.start({
        taskId: first.id,
        baseCommit,
        policy,
        reviewId: "review-marker-first",
        now: firstNow,
      });
      yield* reviews.start({
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
        findings: blockingFindings("review-marker-first"),
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

      const nonNew = yield* reviews.start({
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

      const unknown = yield* reviews.start({
        taskId: publicTaskId("BY-404"),
        baseCommit,
        policy,
        reviewId: "review-missing",
        now: secondNow,
      });
      expect(unknown).toEqual({ ok: false, code: "task_not_found" });

      const linkedTask = yield* createTask(tasks, "Linked", secondNow);
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "link New Task to Change fixture",
        (sql) => sql`
          INSERT INTO changes (
            id, repository_common_directory, branch_ref, task_id, state, created_at, updated_at
          ) VALUES (
            'change-linked', '/repo/.git', 'refs/heads/linked', ${linkedTask.id},
            'open', ${secondNow}, ${secondNow}
          )
        `,
      );
      const linked = yield* reviews.start({
        taskId: linkedTask.id,
        baseCommit,
        policy,
        reviewId: "review-linked",
        now: secondNow,
      });
      expect(linked).toEqual({ ok: false, code: "task_linked_to_change" });
    }),
  ),
);

it.scoped("rejects an orphaned running Review before another admission", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Orphaned running Review", firstNow);
      const started = yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-orphaned",
        now: firstNow,
      });
      if (!started.ok) throw new Error("start failed");

      const repository = yield* RepositorySql;
      yield* repository.operation(
        "orphan running Task Review",
        (sql) => sql`DELETE FROM active_task_reviews WHERE review_id = 'review-orphaned'`,
      );

      const attempted = yield* Effect.either(
        reviews.start({
          taskId: task.id,
          baseCommit,
          policy,
          reviewId: "review-must-not-compete",
          now: secondNow,
        }),
      );
      expect(attempted).toMatchObject({
        _tag: "Left",
        left: { _tag: "RepositoryPersistedDataInvalid" },
      });
      const rows = yield* repository.operation(
        "count Task Reviews after orphan rejection",
        (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM task_reviews`,
      );
      expect(rows[0]?.count).toBe(1);
    }),
  ),
);

it.scoped("rejects malformed persisted Review evidence before another admission", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Corrupt history", firstNow);
      const started = yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-corrupt-history",
        now: firstNow,
      });
      if (!started.ok) throw new Error("start failed");
      yield* recordRemovedWorkspace(reviews, "review-corrupt-history", secondNow);
      const completed = yield* reviews.complete({
        reviewId: "review-corrupt-history",
        outcome: "passed",
        now: secondNow,
      });
      if (!completed.ok) throw new Error(completed.code);

      const repository = yield* RepositorySql;
      yield* repository.operation(
        "corrupt Task Review proposal identity",
        (sql) =>
          sql`UPDATE task_reviews SET proposal_key = 'different' WHERE id = 'review-corrupt-history'`,
      );

      expect(
        yield* Effect.isFailure(
          reviews.start({
            taskId: task.id,
            baseCommit,
            policy,
            reviewId: "review-must-not-start",
            now: secondNow,
          }),
        ),
      ).toBe(true);
      const rows = yield* repository.operation(
        "count Task Reviews after rejected admission",
        (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM task_reviews`,
      );
      expect(rows[0]?.count).toBe(1);
    }),
  ),
);

it.scoped("rejects malformed persisted workspace evidence before another admission", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Corrupt workspace history", firstNow);
      const started = yield* reviews.start({
        taskId: task.id,
        baseCommit,
        policy,
        reviewId: "review-corrupt-workspace",
        workspaceSetup: {
          tempRefName: "refs/but-why/task-reviews/review-corrupt-workspace/review",
          worktreePath: "/tmp/worktrees/review-corrupt-workspace",
        },
        now: firstNow,
      });
      if (!started.ok) throw new Error("start failed");
      yield* recordRemovedWorkspace(reviews, "review-corrupt-workspace", secondNow);
      const completed = yield* reviews.complete({
        reviewId: "review-corrupt-workspace",
        outcome: "passed",
        now: secondNow,
      });
      if (!completed.ok) throw new Error(completed.code);

      const repository = yield* RepositorySql;
      yield* repository.operation(
        "corrupt Task Review workspace evidence",
        (sql) =>
          sql`UPDATE task_review_workspace_setups SET temp_ref_name = ''
            WHERE review_id = 'review-corrupt-workspace'`,
      );

      const attempted = yield* Effect.either(
        reviews.start({
          taskId: task.id,
          baseCommit,
          policy,
          reviewId: "review-after-corrupt-workspace",
          now: thirdNow,
        }),
      );
      expect(attempted).toMatchObject({
        _tag: "Left",
        left: { _tag: "RepositoryPersistedDataInvalid" },
      });

      yield* repository.operation(
        "remove Task Review workspace evidence",
        (sql) =>
          sql`DELETE FROM task_review_workspace_setups
            WHERE review_id = 'review-corrupt-workspace'`,
      );
      const missingWorkspace = yield* Effect.either(
        reviews.start({
          taskId: task.id,
          baseCommit,
          policy,
          reviewId: "review-after-missing-workspace",
          now: thirdNow,
        }),
      );
      expect(missingWorkspace).toMatchObject({
        _tag: "Left",
        left: { _tag: "RepositoryPersistedDataInvalid" },
      });
      const rows = yield* repository.operation(
        "count Task Reviews after malformed workspace rejection",
        (sql) => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM task_reviews`,
      );
      expect(rows[0]?.count).toBe(1);
    }),
  ),
);

it.scoped("rejects malformed persisted values at each owning boundary", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      const task = yield* createTask(tasks, "Decoded", firstNow);
      const started = yield* reviews.start({
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
      if (!started.ok) throw new Error("start failed");
      yield* reviews.recordToolingFailure({
        reviewId: "review-decoded",
        errorKind: "infrastructure_tooling_failed",
        operationName: "run_task_reviewer_agent",
        errorMessage: "Agent launch failed.",
        now: secondNow,
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
    }),
  ),
);
