import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { internalTaskId, publicTaskId } from "../../src/task/taskId.js";
import { passTaskReviewFixture, withTemporaryRepositoryState } from "../support/repository.js";
import { editTaskDependenciesForTaskChange as editTaskDependenciesInSqlite } from "../support/taskChangeOperations.js";
import {
  createTaskInSqlite,
  getTaskInSqlite,
  listTasksInSqlite,
} from "../support/taskOperations.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

it.scoped("edits the complete direct Task dependency list", () =>
  withTasks(() =>
    Effect.gen(function* () {
      yield* createTask("First");
      yield* createTask("Second");
      yield* createTask("Dependent", ["BY-1"]);

      expect(
        yield* editTaskDependenciesInSqlite({
          taskId: publicTaskId("BY-3"),
          operation: "replace",
          prerequisiteTaskIds: [publicTaskId("BY-2")],
        }),
      ).toMatchObject({
        ok: true,
        task: { prerequisites: [{ id: "BY-2", title: "Second", state: "new" }] },
      });
      expect(yield* getTaskInSqlite(publicTaskId("BY-1"))).toMatchObject({ dependents: [] });
      expect(
        yield* editTaskDependenciesInSqlite({
          taskId: publicTaskId("BY-3"),
          operation: "clear",
          prerequisiteTaskIds: [],
        }),
      ).toMatchObject({ ok: true, task: { prerequisites: [] } });
    }),
  ),
);

it.scoped("rejects invalid Task dependencies without changing the graph", () =>
  withTasks(() =>
    Effect.gen(function* () {
      yield* createTask("First");
      yield* createTask("Second");
      yield* createTask("Dependent", ["BY-1"]);

      for (const [dependencies, code] of [
        [["BY-404"], "dependency_unknown_task"],
        [["BY-3"], "dependency_self"],
        [["BY-1", "BY-1"], "dependency_duplicate"],
      ] as const) {
        expect(
          yield* editTaskDependenciesInSqlite({
            taskId: publicTaskId("BY-3"),
            operation: "replace",
            prerequisiteTaskIds: dependencies.map(publicTaskId),
          }),
        ).toMatchObject({ ok: false, code });
        expect(yield* getTaskInSqlite(publicTaskId("BY-3"))).toMatchObject({
          prerequisites: [{ id: "BY-1", title: "First", state: "new" }],
        });
      }
    }),
  ),
);

it.scoped("rejects Task dependency cycles without changing the graph", () =>
  withTasks(() =>
    Effect.gen(function* () {
      yield* createTask("First");
      yield* createTask("Second", ["BY-1"]);
      yield* createTask("Third", ["BY-2"]);

      expect(
        yield* editTaskDependenciesInSqlite({
          taskId: publicTaskId("BY-1"),
          operation: "replace",
          prerequisiteTaskIds: [publicTaskId("BY-3")],
        }),
      ).toMatchObject({ ok: false, code: "dependency_cycle" });
      expect(yield* getTaskInSqlite(publicTaskId("BY-1"))).toMatchObject({ prerequisites: [] });
    }),
  ),
);

it.scoped(
  "rejects direct Task dependency edits for approved Tasks without changing the graph",
  () =>
    withTasks((repositoryRoot) =>
      Effect.gen(function* () {
        yield* createTask("First");
        yield* createTask("Second");
        yield* createTask("Dependent", ["BY-1"]);
        yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-3"), secondNow);

        for (const operation of ["add", "remove", "replace", "clear"] as const) {
          expect(
            yield* editTaskDependenciesInSqlite({
              taskId: publicTaskId("BY-3"),
              operation,
              prerequisiteTaskIds:
                operation === "clear"
                  ? []
                  : [publicTaskId(operation === "remove" ? "BY-1" : "BY-2")],
            }),
          ).toEqual({ ok: false, code: "dependencies_locked", state: "todo" });
          expect(yield* getTaskInSqlite(publicTaskId("BY-3"))).toMatchObject({
            prerequisites: [{ id: "BY-1", title: "First", state: "new" }],
          });
        }
      }),
    ),
);

it.scoped("rejects coordinated Task dependency edits for Change-linked Tasks", () =>
  withTasks(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* createTask("Linked");
      yield* createTask("Dependency");
      yield* repository.operation(
        "create linked Change fixture",
        (sql) => sql`INSERT INTO changes (
          id, branch_ref, base_ref, base_remote_url, worktree_path,
          initial_acceptance_context, reviewer_configuration, checks_definition, cleanup_pending
        ) VALUES (
          1, 'refs/heads/change-linked', 'refs/remotes/origin/main',
          'https://example.test/repo.git', '/repo-worktrees/change-linked',
          '{"version":1,"title":"Linked","description":"Linked"}',
          '{"acceptanceReview":null,"specialistReviews":[]}', '[{"id":"quality","command":"true","timeoutSeconds":30}]', 0
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
        yield* editTaskDependenciesInSqlite({
          taskId: publicTaskId("BY-1"),
          operation: "add",
          prerequisiteTaskIds: [publicTaskId("BY-2")],
        }),
      ).toEqual({ ok: false, code: "dependencies_locked", state: "new" });
      expect(yield* getTaskInSqlite(publicTaskId("BY-1"))).toMatchObject({ prerequisites: [] });
    }),
  ),
);

it.scoped("continues to reject direct Task dependency edits for terminal Tasks", () =>
  withTasks(() =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* createTask("First");
      yield* createTask("Dependent", ["BY-1"]);

      for (const state of ["done", "cancelled"] as const) {
        yield* repository.operation(
          "set terminal Task fixture state",
          (sql) => sql`
            UPDATE tasks SET state = ${state},
              cancel_reason = ${state === "cancelled" ? "Cancelled fixture" : null}
            WHERE id = ${internalTaskId(publicTaskId("BY-2"), "BY")}
          `,
        );
        expect(
          yield* editTaskDependenciesInSqlite({
            taskId: publicTaskId("BY-2"),
            operation: "add",
            prerequisiteTaskIds: [publicTaskId("BY-1")],
          }),
        ).toEqual({ ok: false, code: "dependencies_locked", state });
        expect(yield* getTaskInSqlite(publicTaskId("BY-2"))).toMatchObject({
          prerequisites: [{ id: "BY-1", title: "First", state: "new" }],
        });
      }
    }),
  ),
);

it.scoped("returns direct Task dependency facts and start eligibility", () =>
  withTasks((repositoryRoot) =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* createTask("Done prerequisite");
      yield* createTask("Open prerequisite");
      yield* createTask("Dependent", ["BY-1", "BY-2"]);
      yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-1"), secondNow);
      yield* passTaskReviewFixture(repositoryRoot, publicTaskId("BY-3"), secondNow);
      yield* repository.operation(
        "set done prerequisite fixture",
        (sql) => sql`
        UPDATE tasks SET state = 'done'
        WHERE id = ${internalTaskId(publicTaskId("BY-1"), "BY")}
      `,
      );

      expect(yield* getTaskInSqlite(publicTaskId("BY-3"))).toMatchObject({
        prerequisites: [
          { id: "BY-1", title: "Done prerequisite", state: "done" },
          { id: "BY-2", title: "Open prerequisite", state: "new" },
        ],
      });
      expect(yield* getTaskInSqlite(publicTaskId("BY-2"))).toMatchObject({
        dependents: [{ id: "BY-3", title: "Dependent", state: "todo" }],
      });
      const listed = yield* listTasksInSqlite({ includeDone: true });
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

const withTasks = <A, E>(use: (repositoryRoot: string) => Effect.Effect<A, E, RepositorySql>) => {
  return withTemporaryRepositoryState(({ repositoryRoot }) => use(repositoryRoot));
};

const createTask = (title: string, dependencies: readonly string[] = []) =>
  Effect.gen(function* () {
    const result = yield* createTaskInSqlite({
      title,
      description: `Description for ${title}`,
      now: firstNow,
      dependsOn: dependencies.map(publicTaskId),
    });
    if (!result.ok) throw new Error(result.code);
    return result.task;
  });
