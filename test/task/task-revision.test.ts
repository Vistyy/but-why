import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { taskReviewBuiltInInstructions } from "../../src/reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteTaskPersistence } from "../../src/task/adapters/sqlite/sqliteTaskPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../src/task/adapters/sqlite/sqliteTaskReviewPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { openSqliteTaskChangeTaskPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangePersistence.js";
import { taskChangeTaskOperations } from "../../src/taskChange/composition/loadTaskChangePersistence.js";
import {
  passTaskReviewFixture,
  setTerminalTaskStateFixture,
  withTemporaryRepositoryState,
} from "../support/repository.js";

const now = "2026-08-12T10:00:00.000Z";
const later = "2026-08-12T10:05:00.000Z";
const policy = {
  profile: {
    agentProfile: "review",
    scope: "global" as const,
    profile: {
      agentRuntime: "pi" as const,
      runtimeConfig: { model: "test-model" },
    },
  },
  builtInInstructions: taskReviewBuiltInInstructions,
  guidance: null,
};

it.scoped("revises an unlinked Todo Task while preserving its intent and Review evidence", () =>
  withTemporaryRepositoryState(({ repositoryRoot }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Dependency", description: "Required", now });
      yield* tasks.createTask({
        title: "Approved proposal",
        description: "Approved intent",
        dependsOn: [publicTaskId("BY-1")],
        now,
      });
      const completed = yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-2"), now);
      const before = yield* tasks.getTaskById(publicTaskId("BY-2"));

      expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-2"), now: later })).toMatchObject({
        ok: true,
        changed: true,
        task: {
          id: "BY-2",
          state: "new",
          description: "Approved intent",
          prerequisites: [{ id: "BY-1" }],
        },
      });
      expect(yield* tasks.getTaskContextById(publicTaskId("BY-2"))).toEqual({
        id: "BY-2",
        title: "Approved proposal",
        description: "Approved intent",
      });
      expect(yield* reviews.listForTask(publicTaskId("BY-2"))).toMatchObject([
        { id: completed.review.id, state: "complete", outcome: "passed" },
      ]);
      expect(before).toMatchObject({ state: "todo" });
      expect(yield* reviews.reuseJudgment(publicTaskId("BY-2"), later)).toMatchObject({
        ok: true,
        outcome: "passed",
        review: { id: completed.review.id },
        task: { id: "BY-2", state: "todo" },
      });
    }),
  ),
);

it.scoped("renames a New Task while preserving its identity and surrounding facts", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const taskChanges = yield* openSqliteTaskChangeTaskPersistence(taskChangeTaskOperations);
      yield* tasks.createTask({ title: "Dependency", description: "Required", now });
      yield* tasks.createTask({
        title: "Original title",
        description: "Approved intent",
        dependsOn: [publicTaskId("BY-1")],
        now,
      });

      expect(
        yield* taskChanges.renameTask({ taskId: publicTaskId("BY-2"), title: "New title" }),
      ).toMatchObject({
        ok: true,
        noOp: false,
        task: {
          id: "BY-2",
          title: "New title",
          state: "new",
          description: "Approved intent",
          prerequisites: [{ id: "BY-1" }],
        },
      });
      expect(
        yield* taskChanges.renameTask({ taskId: publicTaskId("BY-2"), title: "New title" }),
      ).toMatchObject({
        ok: true,
        noOp: true,
        task: { id: "BY-2", title: "New title", state: "new" },
      });
    }),
  ),
);

it.scoped("requires revision before renaming a Todo Task", () =>
  withTemporaryRepositoryState(({ repositoryRoot }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const taskChanges = yield* openSqliteTaskChangeTaskPersistence(taskChangeTaskOperations);
      const reviews = yield* openSqliteTaskReviewPersistence();
      yield* tasks.createTask({ title: "Approved title", description: "Intent", now });
      yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-1"), now);
      const reviewBefore = yield* reviews.listForTask(publicTaskId("BY-1"));

      expect(
        yield* taskChanges.renameTask({ taskId: publicTaskId("BY-1"), title: "Changed title" }),
      ).toEqual({ ok: false, code: "task_revision_required", state: "todo" });
      yield* tasks.reviseTask({ taskId: publicTaskId("BY-1"), now: later });
      expect(
        yield* taskChanges.renameTask({ taskId: publicTaskId("BY-1"), title: "Changed title" }),
      ).toMatchObject({ ok: true, noOp: false, task: { title: "Changed title", state: "new" } });
      expect(yield* reviews.listForTask(publicTaskId("BY-1"))).toEqual(reviewBefore);
      expect(yield* reviews.reuseJudgment(publicTaskId("BY-1"), later)).toBeUndefined();
    }),
  ),
);

it.scoped("treats eligible New Task revision as an idempotent no-op", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      yield* tasks.createTask({ title: "New proposal", description: "Editable", now });

      expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-1"), now: later })).toMatchObject({
        ok: true,
        changed: false,
        task: { state: "new" },
      });
    }),
  ),
);

it.scoped(
  "rejects revision for linked, actively reviewed, and terminal Tasks without mutation",
  () =>
    withTemporaryRepositoryState(({ repositoryRoot }) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence();
        const reviews = yield* openSqliteTaskReviewPersistence();
        const taskChanges = yield* openSqliteTaskChangeTaskPersistence(taskChangeTaskOperations);
        const repository = yield* RepositorySql;
        for (const title of ["Linked", "Reviewed", "Done", "Cancelled"]) {
          yield* tasks.createTask({ title, description: `${title} intent`, now });
        }
        yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-1"), now);
        yield* repository.operation(
          "link Todo Task fixture to Change",
          (sql) => sql`INSERT INTO changes (
          id, branch_ref, base_ref, base_remote_url, worktree_path,
          initial_acceptance_context, reviewer_configuration, checks_definition, cleanup_pending
        ) VALUES (
          1, 'refs/heads/change-linked', 'refs/remotes/origin/main',
          'https://example.test/repo.git', '/repo-worktrees/change-linked',
          '{"version":1,"title":"Linked","description":"Linked intent"}',
          '{"acceptanceReview":null,"specialistReviews":[]}', '[{"id":"quality","command":"true","timeoutSeconds":30}]', 0
        )`,
        );
        yield* repository.operation(
          "link Todo Task fixture to Change",
          (sql) => sql`
            INSERT INTO task_change_links (task_id, change_id)
            VALUES (1, 1)
          `,
        );
        yield* reviews.admit({
          taskId: publicTaskId("BY-2"),
          policy,
          baseRef: "refs/heads/main",
          baseCommit: "a".repeat(40),
          now,
        });
        yield* setTerminalTaskStateFixture(publicTaskId("BY-3"), "done", now);
        yield* setTerminalTaskStateFixture(publicTaskId("BY-4"), "cancelled", now);

        expect(yield* taskChanges.reviseTask({ taskId: publicTaskId("BY-1"), now: later })).toEqual(
          {
            ok: false,
            code: "task_change_linked",
            changeId: "BY-C1",
          },
        );
        expect(
          yield* taskChanges.renameTask({ taskId: publicTaskId("BY-1"), title: "Linked" }),
        ).toMatchObject({ ok: true, noOp: true, task: { title: "Linked", state: "todo" } });
        expect(
          yield* taskChanges.renameTask({ taskId: publicTaskId("BY-1"), title: "Changed" }),
        ).toEqual({ ok: false, code: "task_change_linked", changeId: "BY-C1" });
        expect(yield* tasks.reviseTask({ taskId: publicTaskId("BY-2"), now: later })).toMatchObject(
          {
            ok: false,
            code: "active_task_review",
          },
        );
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
        expect(
          yield* taskChanges.renameTask({ taskId: publicTaskId("BY-3"), title: "Done" }),
        ).toMatchObject({ ok: true, noOp: true, task: { title: "Done", state: "done" } });
        expect(
          yield* taskChanges.renameTask({ taskId: publicTaskId("BY-3"), title: "Changed done" }),
        ).toEqual({ ok: false, code: "invalid_task_state", state: "done" });
        expect(
          yield* taskChanges.renameTask({ taskId: publicTaskId("BY-4"), title: "Cancelled" }),
        ).toMatchObject({ ok: true, noOp: true, task: { title: "Cancelled", state: "cancelled" } });
        expect(
          yield* taskChanges.renameTask({
            taskId: publicTaskId("BY-4"),
            title: "Changed cancelled",
          }),
        ).toEqual({ ok: false, code: "invalid_task_state", state: "cancelled" });
        for (const id of ["BY-1", "BY-2", "BY-3", "BY-4"] as const) {
          expect(yield* tasks.getTaskById(publicTaskId(id))).toBeDefined();
        }
      }),
    ),
);
