import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import { openSqliteTaskChangeTaskPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangePersistence.js";
import { passTaskReviewFixture, withTemporaryRepositoryState } from "../support/repository.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

it.scoped("edits the complete direct Task dependency list", () =>
  withTasks((tasks) =>
    Effect.gen(function* () {
      yield* createTask(tasks, "First");
      yield* createTask(tasks, "Second");
      yield* createTask(tasks, "Dependent", ["BY-1"]);

      expect(
        yield* tasks.editTaskDependencies({
          taskId: publicTaskId("BY-3"),
          operation: "replace",
          prerequisiteTaskIds: [publicTaskId("BY-2")],
        }),
      ).toMatchObject({
        ok: true,
        task: { prerequisites: [{ id: "BY-2", title: "Second", state: "new" }] },
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ dependents: [] });
      expect(
        yield* tasks.editTaskDependencies({
          taskId: publicTaskId("BY-3"),
          operation: "clear",
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
          yield* tasks.editTaskDependencies({
            taskId: publicTaskId("BY-3"),
            operation: "replace",
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
        yield* tasks.editTaskDependencies({
          taskId: publicTaskId("BY-1"),
          operation: "replace",
          prerequisiteTaskIds: [publicTaskId("BY-3")],
        }),
      ).toMatchObject({ ok: false, code: "dependency_cycle" });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ prerequisites: [] });
    }),
  ),
);

it.scoped(
  "rejects direct Task dependency edits for approved Tasks without changing the graph",
  () =>
    withTasks((tasks) =>
      Effect.gen(function* () {
        yield* createTask(tasks, "First");
        yield* createTask(tasks, "Second");
        yield* createTask(tasks, "Dependent", ["BY-1"]);
        yield* passTaskReviewFixture(publicTaskId("BY-3"), secondNow);

        for (const operation of ["add", "remove", "replace", "clear"] as const) {
          expect(
            yield* tasks.editTaskDependencies({
              taskId: publicTaskId("BY-3"),
              operation,
              prerequisiteTaskIds:
                operation === "clear"
                  ? []
                  : [publicTaskId(operation === "remove" ? "BY-1" : "BY-2")],
            }),
          ).toEqual({ ok: false, code: "dependencies_locked", state: "todo" });
          expect(yield* tasks.getTaskById(publicTaskId("BY-3"))).toMatchObject({
            prerequisites: [{ id: "BY-1", title: "First", state: "new" }],
          });
        }
      }),
    ),
);

it.scoped("rejects coordinated Task dependency edits for Change-linked Tasks", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const taskChanges = yield* openSqliteTaskChangeTaskPersistence();
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "Linked");
      yield* createTask(tasks, "Dependency");
      yield* repository.operation(
        "create linked Change fixture",
        (sql) => sql`INSERT INTO changes (
          id, repository_common_directory, branch_ref, state, acceptance_context,
          base_ref, base_remote_url, starting_commit, worktree_path, created_at, updated_at
        ) VALUES (
          1, '/repo/.git', 'refs/heads/change-linked', 'open',
          '{"version":1,"title":"Linked","description":"Linked"}',
          'refs/remotes/origin/main', 'https://example.test/repo.git', ${"a".repeat(40)},
          '/repo-worktrees/change-linked', ${firstNow}, ${firstNow}
        )`,
      );
      yield* repository.operation(
        "link Task fixture to Change",
        (sql) => sql`
          INSERT INTO task_change_links (task_id, change_id)
          VALUES (1, 1)
        `,
      );

      expect(
        yield* taskChanges.editTaskDependencies({
          taskId: publicTaskId("BY-1"),
          operation: "add",
          prerequisiteTaskIds: [publicTaskId("BY-2")],
        }),
      ).toEqual({ ok: false, code: "dependencies_locked", state: "new" });
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({ prerequisites: [] });
    }),
  ),
);

it.scoped("continues to reject direct Task dependency edits for terminal Tasks", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "First");
      yield* createTask(tasks, "Dependent", ["BY-1"]);

      for (const state of ["done", "cancelled"] as const) {
        yield* repository.operation(
          "set terminal Task fixture state",
          (sql) => sql`
            UPDATE tasks SET state = ${state},
              cancel_reason = ${state === "cancelled" ? "Cancelled fixture" : null},
              updated_at = ${secondNow} WHERE id = ${publicTaskId("BY-2")}
          `,
        );
        expect(
          yield* tasks.editTaskDependencies({
            taskId: publicTaskId("BY-2"),
            operation: "add",
            prerequisiteTaskIds: [publicTaskId("BY-1")],
          }),
        ).toEqual({ ok: false, code: "dependencies_locked", state });
        expect(yield* tasks.getTaskById(publicTaskId("BY-2"))).toMatchObject({
          prerequisites: [{ id: "BY-1", title: "First", state: "new" }],
        });
      }
    }),
  ),
);

it.scoped("returns direct Task dependency facts and start eligibility", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "Done prerequisite");
      yield* createTask(tasks, "Open prerequisite");
      yield* createTask(tasks, "Dependent", ["BY-1", "BY-2"]);
      yield* passTaskReviewFixture(publicTaskId("BY-1"), secondNow);
      yield* passTaskReviewFixture(publicTaskId("BY-3"), secondNow);
      yield* repository.operation(
        "set done prerequisite fixture",
        (sql) => sql`
        UPDATE tasks SET state = 'done', updated_at = ${secondNow} WHERE id = ${publicTaskId("BY-1")}
      `,
      );

      expect(yield* tasks.getTaskById(publicTaskId("BY-3"))).toMatchObject({
        prerequisites: [
          { id: "BY-1", title: "Done prerequisite", state: "done" },
          { id: "BY-2", title: "Open prerequisite", state: "new" },
        ],
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-2"))).toMatchObject({
        dependents: [{ id: "BY-3", title: "Dependent", state: "todo" }],
      });
      const listed = yield* tasks.listTasks({ includeDone: true });
      expect(listed.total).toBe(3);
      expect(listed.tasks).toContainEqual(
        expect.objectContaining({
          id: "BY-3",
          startable: false,
          blockedBy: [{ id: "BY-2", title: "Open prerequisite", state: "new" }],
        }),
      );
    }),
  ),
);

const withTasks = <A, E>(use: (tasks: TaskPersistence) => Effect.Effect<A, E, RepositorySql>) => {
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
