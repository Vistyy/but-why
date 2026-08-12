import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { setTaskStateFixture, withTemporaryRepositoryState } from "../support/repository.js";

const now = "2026-08-12T10:00:00.000Z";
const later = "2026-08-12T10:05:00.000Z";
const policy = {
  profile: {
    agentProfile: "review",
    scope: "global" as const,
    profile: { agentRuntime: "pi" as const },
  },
  builtInInstructions: taskReviewBuiltInInstructions,
  guidance: null,
};

it.scoped("revises an unlinked Todo Task while preserving its intent and Review evidence", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Dependency", description: "Required", now });
      yield* tasks.createTask({
        title: "Approved proposal",
        description: "Approved intent",
        dependsOn: [publicTaskId("BY-1")],
        now,
      });
      yield* reviews.admit({
        reviewId: "review-retained",
        taskId: publicTaskId("BY-2"),
        policy,
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        workspacePath: "/tmp/review-retained",
        now,
      });
      yield* reviews.recordCleanup("review-retained", "removed", now);
      yield* reviews.complete({ reviewId: "review-retained", findings: [], now });
      yield* setTaskStateFixture(publicTaskId("BY-2"), "todo", now);
      const before = yield* tasks.getTaskById(publicTaskId("BY-2"));

      expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-2"), now: later })).toMatchObject({
        ok: true,
        changed: true,
        task: {
          id: "BY-2",
          state: "new",
          description: "Approved intent",
          updatedAt: later,
          prerequisites: [{ id: "BY-1" }],
        },
      });
      expect(yield* tasks.getTaskContextById(publicTaskId("BY-2"))).toEqual({
        id: "BY-2",
        title: "Approved proposal",
        description: "Approved intent",
      });
      expect(yield* reviews.listForTask(publicTaskId("BY-2"))).toMatchObject([
        { id: "review-retained", state: "complete", outcome: "passed" },
      ]);
      expect(before).toMatchObject({ state: "todo", updatedAt: now });
    }),
  ),
);

it.scoped("treats eligible New Task revision as an idempotent no-op", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      yield* tasks.createTask({ title: "New proposal", description: "Editable", now });

      expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-1"), now: later })).toMatchObject({
        ok: true,
        changed: false,
        task: { state: "new", updatedAt: now },
      });
    }),
  ),
);

it.scoped(
  "rejects revision for linked, actively reviewed, and terminal Tasks without mutation",
  () =>
    withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const reviews = yield* openSqliteTaskReviewPersistence();
        const repository = yield* RepositorySql;
        for (const title of ["Linked", "Reviewed", "Done", "Cancelled"]) {
          yield* tasks.createTask({ title, description: `${title} intent`, now });
        }
        yield* setTaskStateFixture(publicTaskId("BY-1"), "todo", now);
        yield* repository.operation(
          "link Todo Task fixture to Change",
          (sql) => sql`INSERT INTO changes (
          id, repository_common_directory, branch_ref, task_id, state, acceptance_context,
          base_ref, base_remote_url, starting_commit, worktree_path, created_at, updated_at
        ) VALUES (
          'change-linked', '/repo/.git', 'refs/heads/change-linked', 'BY-1', 'open',
          '{"version":1,"title":"Linked","description":"Linked intent"}',
          'refs/remotes/origin/main', 'https://example.test/repo.git', ${"a".repeat(40)},
          '/repo-worktrees/change-linked', ${now}, ${now}
        )`,
        );
        yield* reviews.admit({
          reviewId: "review-active",
          taskId: publicTaskId("BY-2"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          workspacePath: "/tmp/review-active",
          now,
        });
        yield* setTaskStateFixture(publicTaskId("BY-3"), "done", now);
        yield* setTaskStateFixture(publicTaskId("BY-4"), "cancelled", now);

        expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-1"), now: later })).toEqual({
          ok: false,
          code: "task_change_linked",
          changeId: "change-linked",
        });
        expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-2"), now: later })).toEqual({
          ok: false,
          code: "active_task_review",
          reviewId: "review-active",
        });
        expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-3"), now: later })).toEqual({
          ok: false,
          code: "invalid_task_state",
          state: "done",
        });
        expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-4"), now: later })).toEqual({
          ok: false,
          code: "invalid_task_state",
          state: "cancelled",
        });
        for (const id of ["BY-1", "BY-2", "BY-3", "BY-4"] as const) {
          expect(yield* tasks.getTaskById(publicTaskId(id))).toMatchObject({ updatedAt: now });
        }
      }),
    ),
);
