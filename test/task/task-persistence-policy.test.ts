import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  passTaskReviewFixture,
  setTerminalTaskStateFixture,
  withTemporaryRepositoryState,
} from "../support/repository.js";
import {
  createTaskInSqlite,
  getTaskContextInSqlite,
  listTasksInSqlite,
  updateTaskContextInSqlite,
} from "../support/taskOperations.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const terminalStates = ["done", "cancelled"] as const;

it.scoped("preserves ID-shaped freeform Task Context text", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const created = yield* createTaskInSqlite({
        title: "BY-C1",
        description: "BY-1",
        now: firstNow,
      });

      expect(created).toMatchObject({
        ok: true,
        task: { title: "BY-C1", description: "BY-1" },
        context: { title: "BY-C1", description: "BY-1" },
      });
    }),
  ),
);

it.scoped("preserves terminal Task policy", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      for (const [index, state] of terminalStates.entries()) {
        const created = yield* createTaskInSqlite({
          title: `Policy Task ${state}`,
          description: "Task policy behavior",
          now: firstNow,
        });
        if (!created.ok) throw new Error(created.code);
        const taskId = publicTaskId(`BY-${index + 1}`);
        yield* setTerminalTaskStateFixture(taskId, state, secondNow);
        const contextBefore = yield* getTaskContextInSqlite(taskId);

        expect(
          yield* updateTaskContextInSqlite({
            taskId,
            description: "Changed description",
            now: thirdNow,
          }),
        ).toEqual({
          ok: false,
          code: "invalid_task_state",
          state,
        });
        expect(yield* getTaskContextInSqlite(taskId)).toEqual(contextBefore);
      }
    }),
  );
});

it.scoped(
  "rejects Task Context mutation for approved Tasks without changing stored Context",
  () => {
    return withTemporaryRepositoryState(({ repositoryRoot }) =>
      Effect.gen(function* () {
        const approved = yield* createTaskInSqlite({
          title: "Approved title",
          description: "Approved description",
          now: firstNow,
        });
        if (!approved.ok) throw new Error(approved.code);
        const taskId = publicTaskId("BY-1");
        yield* passTaskReviewFixture(repositoryRoot, taskId, secondNow);

        for (const description of ["Approved description", "Changed description"]) {
          expect(
            yield* updateTaskContextInSqlite({
              taskId,
              description,
              now: thirdNow,
            }),
          ).toEqual({
            ok: false,
            code: "task_revision_required",
            state: "todo",
          });
          expect(yield* getTaskContextInSqlite(taskId)).toEqual({
            id: taskId,
            title: "Approved title",
            description: "Approved description",
          });
        }

        const unlinked = yield* createTaskInSqlite({
          title: "New title",
          description: "New description",
          now: firstNow,
        });
        if (!unlinked.ok) throw new Error(unlinked.code);
        expect(
          yield* updateTaskContextInSqlite({
            taskId: publicTaskId("BY-2"),
            description: "Edited description",
            now: thirdNow,
          }),
        ).toMatchObject({
          ok: true,
          task: { title: "New title", description: "Edited description" },
        });
      }),
    );
  },
);

it.scoped("batches Task list relationships beyond one SQL parameter batch", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation(
        "insert Task list batch fixture",
        (sql) => sql`
          WITH RECURSIVE numbers(n) AS (
            SELECT 1
            UNION ALL
            SELECT n + 1 FROM numbers WHERE n < 1001
          )
          INSERT INTO tasks (id, title, description, state)
          SELECT n, 'Task ' || n, 'Description ' || n, 'new' FROM numbers
        `,
      );
      yield* repository.operation(
        "insert Task list relationship fixture",
        (sql) => sql`
          INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
          VALUES (1001, 1000)
        `,
      );

      const listed = yield* listTasksInSqlite({ includeDone: false, limit: "all" });
      expect(listed.total).toBe(1001);
      expect(listed.tasks).toHaveLength(1001);
      expect(listed.tasks[1000]).toMatchObject({
        id: "BY-1001",
        blockedBy: [{ id: "BY-1000", title: "Task 1000", state: "new" }],
      });
    }),
  ),
);

it.scoped("bounds Task lists after filtering and preserves the matching total", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      yield* createTaskInSqlite({ title: "First", description: "First", now: firstNow });
      yield* createTaskInSqlite({ title: "Second", description: "Second", now: firstNow });
      yield* createTaskInSqlite({ title: "Third", description: "Third", now: firstNow });

      expect(yield* listTasksInSqlite({ includeDone: false, limit: 2 })).toMatchObject({
        total: 3,
        tasks: [{ id: "BY-1" }, { id: "BY-2" }],
      });
      expect(yield* listTasksInSqlite({ includeDone: false, limit: "all" })).toMatchObject({
        total: 3,
        tasks: [{ id: "BY-1" }, { id: "BY-2" }, { id: "BY-3" }],
      });
      expect(yield* listTasksInSqlite({ includeDone: false, state: "done", limit: 2 })).toEqual({
        total: 0,
        tasks: [],
      });
    }),
  );
});
