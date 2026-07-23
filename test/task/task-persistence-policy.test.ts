import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { TaskState } from "../../src/task/lifecycle.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
const closedStates = ["implementing", "validating", "ready", "done"] as const;

it.scoped("preserves Task policy after migration to Effect persistence", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");

      for (const [index, state] of closedStates.entries()) {
        const created = yield* tasks.createTask({
          title: `Policy Task ${state}`,
          description: "Task policy behavior",
          now: firstNow,
        });
        if (!created.ok) throw new Error(created.code);
        const taskId = publicTaskId(`BY-${index + 1}`);
        const approved = yield* tasks.approveTask({ taskId, now: secondNow });
        if (!approved.ok) throw new Error(approved.code);
        yield* transitionTo(tasks, taskId, state);
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

it.scoped("preserves Task ordering and rejects invalid state transitions", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      yield* tasks.createTask({ title: "First", description: "First", now: firstNow });
      yield* tasks.createTask({ title: "Second", description: "Second", now: firstNow });

      expect((yield* tasks.listTasks({ includeDone: false })).map((task) => task.id)).toEqual([
        "BY-1",
        "BY-2",
      ]);
      expect(
        yield* tasks.transitionTaskState({
          taskId: publicTaskId("BY-1"),
          to: "ready",
          now: secondNow,
        }),
      ).toEqual({
        ok: false,
        code: "invalid_task_state_transition",
        from: "new",
        to: "ready",
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({
        state: "new",
        createdAt: firstNow,
        updatedAt: firstNow,
      });
    }),
  );
});

const transitionTo = (
  tasks: TaskPersistence,
  taskId: ReturnType<typeof publicTaskId>,
  target: (typeof closedStates)[number],
) =>
  Effect.gen(function* () {
    for (const state of transitionPath(target)) {
      const result = yield* tasks.transitionTaskState({ taskId, to: state, now: secondNow });
      if (!result.ok) throw new Error(result.code);
    }
  });

const transitionPath = (target: (typeof closedStates)[number]): readonly TaskState[] => {
  const states: readonly TaskState[] = ["implementing", "validating", "ready", "done"];
  return states.slice(0, states.indexOf(target) + 1);
};
