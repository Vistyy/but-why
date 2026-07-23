import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

it.scoped("replaces and clears the complete direct Task dependency list", () =>
  withTasks((tasks) =>
    Effect.gen(function* () {
      yield* createTask(tasks, "First");
      yield* createTask(tasks, "Second");
      yield* createTask(tasks, "Dependent", ["BY-1"]);

      expect(
        yield* tasks.replaceTaskDependencies({
          taskId: publicTaskId("BY-3"),
          prerequisiteTaskIds: [publicTaskId("BY-2")],
        }),
      ).toMatchObject({
        ok: true,
        task: { prerequisites: [{ id: "BY-2", title: "Second", state: "new" }] },
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ dependents: [] });
      expect(
        yield* tasks.replaceTaskDependencies({
          taskId: publicTaskId("BY-3"),
          prerequisiteTaskIds: [],
        }),
      ).toMatchObject({ ok: true, task: { prerequisites: [] } });
    }),
  ),
);

it.scoped("rejects invalid Task dependencies without changing the graph", () =>
  withTasks((tasks) =>
    Effect.gen(function* () {
      yield* createTask(tasks, "First");
      yield* createTask(tasks, "Second");
      yield* createTask(tasks, "Dependent", ["BY-1"]);

      for (const [dependencies, code] of [
        [["BY-404"], "dependency_unknown_task"],
        [["BY-3"], "dependency_self"],
        [["BY-1", "BY-1"], "dependency_duplicate"],
      ] as const) {
        expect(
          yield* tasks.replaceTaskDependencies({
            taskId: publicTaskId("BY-3"),
            prerequisiteTaskIds: dependencies.map(publicTaskId),
          }),
        ).toMatchObject({ ok: false, code });
        expect(yield* tasks.getTaskById(publicTaskId("BY-3"))).toMatchObject({
          prerequisites: [{ id: "BY-1", title: "First", state: "new" }],
        });
      }
    }),
  ),
);

it.scoped("rejects Task dependency cycles without changing the graph", () =>
  withTasks((tasks) =>
    Effect.gen(function* () {
      yield* createTask(tasks, "First");
      yield* createTask(tasks, "Second", ["BY-1"]);
      yield* createTask(tasks, "Third", ["BY-2"]);

      expect(
        yield* tasks.replaceTaskDependencies({
          taskId: publicTaskId("BY-1"),
          prerequisiteTaskIds: [publicTaskId("BY-3")],
        }),
      ).toMatchObject({ ok: false, code: "dependency_cycle" });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ prerequisites: [] });
    }),
  ),
);

it.scoped("returns direct Task dependency facts and start eligibility", () =>
  withTasks((tasks) =>
    Effect.gen(function* () {
      yield* createTask(tasks, "Done prerequisite");
      yield* createTask(tasks, "Open prerequisite");
      yield* createTask(tasks, "Dependent", ["BY-1", "BY-2"]);
      yield* tasks.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow });
      yield* tasks.approveTask({ taskId: publicTaskId("BY-3"), now: secondNow });
      for (const state of ["implementing", "validating", "ready", "done"] as const) {
        yield* tasks.transitionTaskState({
          taskId: publicTaskId("BY-1"),
          to: state,
          now: secondNow,
        });
      }

      expect(yield* tasks.getTaskById(publicTaskId("BY-3"))).toMatchObject({
        prerequisites: [
          { id: "BY-1", title: "Done prerequisite", state: "done" },
          { id: "BY-2", title: "Open prerequisite", state: "new" },
        ],
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-2"))).toMatchObject({
        dependents: [{ id: "BY-3", title: "Dependent", state: "todo" }],
      });
      expect(yield* tasks.listTasks({ includeDone: true })).toContainEqual(
        expect.objectContaining({
          id: "BY-3",
          startable: false,
          blockedBy: [{ id: "BY-2", title: "Open prerequisite", state: "new" }],
        }),
      );
    }),
  ),
);

const withTasks = <A, E>(use: (tasks: TaskPersistence) => Effect.Effect<A, E>) => {
  return withTemporaryRepositoryState(() =>
    Effect.flatMap(openSqliteTaskPersistence("BY"), (tasks) => use(tasks)),
  );
};

const createTask = (tasks: TaskPersistence, title: string, dependencies: readonly string[] = []) =>
  Effect.gen(function* () {
    const result = yield* tasks.createTask({
      title,
      description: `Description for ${title}`,
      now: firstNow,
      dependsOn: dependencies.map(publicTaskId),
    });
    if (!result.ok) throw new Error(result.code);
    return result.task;
  });
