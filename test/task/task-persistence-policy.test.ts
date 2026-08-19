import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
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

it.scoped("preserves ID-shaped freeform Task Context text", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
      const created = yield* tasks.createTask({
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
      const tasks = yield* openSqliteTaskPersistence();

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
      }
    }),
  );
});

it.scoped(
  "rejects Task Context mutation for approved Tasks without changing stored Context",
  () => {
    return withTemporaryRepositoryState(({ repositoryRoot }) =>
      Effect.gen(function* () {
        const tasks = yield* openSqliteTaskPersistence();
        const approved = yield* tasks.createTask({
          title: "Approved title",
          description: "Approved description",
          now: firstNow,
        });
        if (!approved.ok) throw new Error(approved.code);
        const taskId = publicTaskId("BY-1");
        yield* passTaskReviewFixture(repositoryRoot, taskId, secondNow);

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

it.scoped("orders actionable Tasks by lifecycle priority and numeric ID", () => {
  return withTemporaryRepositoryState(({ repositoryRoot }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();

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
      yield* tasks.createTask({
        title: "Blocking New",
        description: "Blocking New",
        now: firstNow,
      });
      yield* tasks.createTask({
        title: "Blocked Todo",
        description: "Blocked Todo",
        dependsOn: [publicTaskId("BY-8")],
        now: firstNow,
      });

      yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-1"), firstNow);
      yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-2"), thirdNow);
      yield* setTerminalTaskStateFixture(publicTaskId("BY-6"), "done", thirdNow);
      yield* setTerminalTaskStateFixture(publicTaskId("BY-7"), "cancelled", thirdNow);
      yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-9"), thirdNow);

      const actionable = yield* tasks.listActionableTasks();
      expect(actionable.map(({ id, state }) => ({ id, state }))).toEqual([
        { id: "BY-3", state: "new" },
        { id: "BY-4", state: "new" },
        { id: "BY-5", state: "new" },
        { id: "BY-8", state: "new" },
        { id: "BY-1", state: "todo" },
        { id: "BY-2", state: "todo" },
      ]);
      expect(actionable.some(({ id }) => id === "BY-6" || id === "BY-7" || id === "BY-9")).toBe(
        false,
      );
    }),
  );
});

it.scoped("bounds Task lists after filtering and preserves the matching total", () => {
  return withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence();
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
