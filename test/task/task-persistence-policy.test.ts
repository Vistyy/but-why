import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import {
  passTaskReviewFixture,
  setTerminalTaskStateFixture,
  withTemporaryRepositoryState,
} from "../support/repository.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const terminalStates = ["done", "cancelled"] as const;

it.scoped("preserves terminal Task policy", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");

      for (const [index, state] of terminalStates.entries()) {
        const created = yield* tasks.createTask({
          title: `Policy Task ${state}`,
          description: "Task policy behavior",
          now: firstNow,
        });
        if (!created.ok) throw new Error(created.code);
        const taskId = publicTaskId(`BY-${index + 1}`);
        yield* setTerminalTaskStateFixture(taskId, state, secondNow);
        const contextBefore = yield* tasks.getTaskContextById(taskId);

        expect(
          yield* tasks.updateTaskContext({
            taskId,
            description: "Changed description",
            now: thirdNow,
          }),
        ).toEqual({
          ok: false,
          code: "invalid_task_state",
          state,
        });
        expect(yield* tasks.getTaskContextById(taskId)).toEqual(contextBefore);
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ updatedAt: secondNow });
      }
    }),
  );
});

it.scoped(
  "rejects Task Context mutation for approved Tasks without changing stored Context",
  () => {
    return withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const approved = yield* tasks.createTask({
          title: "Approved title",
          description: "Approved description",
          now: firstNow,
        });
        if (!approved.ok) throw new Error(approved.code);
        const taskId = publicTaskId("BY-1");
        yield* passTaskReviewFixture(taskId, secondNow);

        for (const description of ["Approved description", "Changed description"]) {
          expect(
            yield* tasks.updateTaskContext({
              taskId,
              description,
              now: thirdNow,
            }),
          ).toEqual({
            ok: false,
            code: "task_revision_required",
            state: "todo",
          });
          expect(yield* tasks.getTaskContextById(taskId)).toEqual({
            id: taskId,
            title: "Approved title",
            description: "Approved description",
          });
        }

        const unlinked = yield* tasks.createTask({
          title: "New title",
          description: "New description",
          now: firstNow,
        });
        if (!unlinked.ok) throw new Error(unlinked.code);
        expect(
          yield* tasks.updateTaskContext({
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

it.scoped(
  "orders actionable Tasks new before todo, newer updated time first, then numeric ID",
  () => {
    return withTemporaryRepositoryState(() =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence("BY");
        const repository = yield* RepositorySql;

        yield* tasks.createTask({
          title: "Todo oldest",
          description: "Todo oldest",
          now: firstNow,
        });
        yield* tasks.createTask({
          title: "Todo newest",
          description: "Todo newest",
          now: firstNow,
        });
        yield* tasks.createTask({ title: "New tied A", description: "New tied A", now: firstNow });
        yield* tasks.createTask({ title: "New middle", description: "New middle", now: firstNow });
        yield* tasks.createTask({ title: "New tied B", description: "New tied B", now: firstNow });
        yield* tasks.createTask({ title: "Done", description: "Done", now: firstNow });
        yield* tasks.createTask({ title: "Cancelled", description: "Cancelled", now: firstNow });

        yield* passTaskReviewFixture(publicTaskId("BY-1"), firstNow);
        yield* passTaskReviewFixture(publicTaskId("BY-2"), thirdNow);
        yield* setTerminalTaskStateFixture(publicTaskId("BY-6"), "done", thirdNow);
        yield* setTerminalTaskStateFixture(publicTaskId("BY-7"), "cancelled", thirdNow);
        yield* repository.operation(
          "set actionable Task fixture timestamps",
          (sql) => sql`
          UPDATE tasks SET
            updated_at = CASE id
              WHEN 1 THEN ${firstNow}
              WHEN 2 THEN ${thirdNow}
              WHEN 3 THEN ${thirdNow}
              WHEN 4 THEN ${secondNow}
              WHEN 5 THEN ${thirdNow}
              ELSE ${thirdNow}
            END
          WHERE id IN (1, 2, 3, 4, 5)
        `,
        );

        const actionable = yield* tasks.listActionableTasks();
        expect(actionable.map(({ id, state, updatedAt }) => ({ id, state, updatedAt }))).toEqual([
          { id: "BY-3", state: "new", updatedAt: thirdNow },
          { id: "BY-5", state: "new", updatedAt: thirdNow },
          { id: "BY-4", state: "new", updatedAt: secondNow },
          { id: "BY-2", state: "todo", updatedAt: thirdNow },
          { id: "BY-1", state: "todo", updatedAt: firstNow },
        ]);
        expect(actionable.some(({ id }) => id === "BY-6" || id === "BY-7")).toBe(false);
      }),
    );
  },
);

it.scoped("bounds Task lists after filtering and preserves the matching total", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      yield* tasks.createTask({ title: "First", description: "First", now: firstNow });
      yield* tasks.createTask({ title: "Second", description: "Second", now: firstNow });
      yield* tasks.createTask({ title: "Third", description: "Third", now: firstNow });

      expect(yield* tasks.listTasks({ includeDone: false, limit: 2 })).toMatchObject({
        total: 3,
        tasks: [{ id: "BY-1" }, { id: "BY-2" }],
      });
      expect(yield* tasks.listTasks({ includeDone: false, limit: "all" })).toMatchObject({
        total: 3,
        tasks: [{ id: "BY-1" }, { id: "BY-2" }, { id: "BY-3" }],
      });
      expect(yield* tasks.listTasks({ includeDone: false, state: "done", limit: 2 })).toEqual({
        total: 0,
        tasks: [],
      });
    }),
  );
});
