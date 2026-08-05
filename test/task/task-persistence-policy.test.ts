import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const terminalStates = ["done", "cancelled"] as const;

it.scoped("preserves terminal Task policy", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const repository = yield* RepositorySql;

      for (const [index, state] of terminalStates.entries()) {
        const created = yield* tasks.createTask({
          title: `Policy Task ${state}`,
          description: "Task policy behavior",
          now: firstNow,
        });
        if (!created.ok) throw new Error(created.code);
        const taskId = publicTaskId(`BY-${index + 1}`);
        const approved = yield* tasks.approveTask({ taskId, now: secondNow });
        if (!approved.ok) throw new Error(approved.code);
        yield* repository.operation(
          "set terminal Task fixture state",
          (sql) => sql`
            UPDATE tasks SET state = ${state}, updated_at = ${secondNow} WHERE id = ${taskId}
          `,
        );
        const contextBefore = yield* tasks.getTaskContextById(taskId);

        expect(yield* tasks.approveTask({ taskId, now: thirdNow })).toEqual({
          ok: false,
          code: "invalid_task_state",
          state,
        });
        expect(
          yield* tasks.appendTaskComment({
            taskId,
            content: "Too late",
            now: () => thirdNow,
          }),
        ).toEqual({ ok: false, code: "invalid_task_state", state });
        expect(yield* tasks.getTaskContextById(taskId)).toEqual(contextBefore);
        expect(yield* tasks.getTaskById(taskId)).toMatchObject({ updatedAt: secondNow });
      }
    }),
  );
});

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
