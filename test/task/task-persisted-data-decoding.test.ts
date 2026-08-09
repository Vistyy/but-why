import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { openSqliteChangeStartPersistence } from "../../src/sqlite/sqliteChangeStartPersistence.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import { withTemporaryRepositoryState } from "../support/repository.js";

const firstNow = "2026-08-09T12:00:00.000Z";
const secondNow = "2026-08-09T12:05:00.000Z";

it.scoped("decodes valid current Task states, relationships, Context, and Change Start facts", () =>
  withTemporaryRepositoryState(({ commonDirectory }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const starts = yield* openSqliteChangeStartPersistence();
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "New prerequisite");
      yield* createTask(tasks, "Blocked todo", ["BY-1"]);
      yield* createTask(tasks, "Done Task");
      yield* createTask(tasks, "Cancelled Task");
      yield* createTask(tasks, "Task with Resolution");
      yield* tasks.approveTask({ taskId: publicTaskId("BY-2"), now: secondNow });
      yield* tasks.approveTask({ taskId: publicTaskId("BY-3"), now: secondNow });
      yield* tasks.approveTask({ taskId: publicTaskId("BY-4"), now: secondNow });
      yield* tasks.approveTask({ taskId: publicTaskId("BY-5"), now: secondNow });
      yield* repository.operation("set terminal Task fixtures", (sql) =>
        sql.unsafe(`
          UPDATE tasks
          SET state = CASE id WHEN 'BY-3' THEN 'done' ELSE 'cancelled' END
          WHERE id IN ('BY-3', 'BY-4')
        `),
      );
      const started = yield* starts.create({
        id: "change-with-resolution",
        repositoryCommonDirectory: commonDirectory,
        branchRef: "refs/heads/but-why/change-with-resolution",
        baseRef: "refs/remotes/origin/main",
        baseRemoteUrl: "https://github.com/acme/repo.git",
        startingCommit: "1111111111111111111111111111111111111111",
        worktreePath: `${commonDirectory}/worktrees/change-with-resolution`,
        taskId: publicTaskId("BY-5"),
        now: secondNow,
      });
      if (!started.ok) throw new Error(started.code);
      yield* repository.operation("insert resolved Blocker fixture", (sql) =>
        sql.unsafe(`
        INSERT INTO implementation_blockers (
          id, change_id, reported_at, content, resolved_at,
          resolution_id, resolution_recorded_at, resolution_content
        ) VALUES (
          'blocker-1', 'change-with-resolution', '${secondNow}', 'Question', '${secondNow}',
          'resolution-1', '${secondNow}', 'Approved resolution'
        )
      `),
      );

      expect(yield* tasks.listTasks({ includeDone: true })).toMatchObject({
        total: 5,
        tasks: [
          { id: "BY-1", state: "new" },
          { id: "BY-2", state: "todo", blockedBy: [{ id: "BY-1" }] },
          { id: "BY-3", state: "done" },
          { id: "BY-4", state: "cancelled" },
          { id: "BY-5", state: "todo", startable: true },
        ],
      });
      expect(yield* tasks.getTaskContextById(publicTaskId("BY-5"))).toEqual({
        id: "BY-5",
        title: "Task with Resolution",
        description: "Description for Task with Resolution",
        resolutions: ["Approved resolution"],
      });
      expect(yield* starts.prepareTask(publicTaskId("BY-2"))).toMatchObject({
        ok: false,
        code: "task_dependencies_unsatisfied",
        blockedBy: [{ id: "BY-1", state: "new" }],
      });
      expect(yield* tasks.getTaskById(publicTaskId("BY-404"))).toBeUndefined();
      expect(yield* tasks.getTaskContextById(publicTaskId("BY-404"))).toBeUndefined();
      expect(yield* starts.prepareTask(publicTaskId("BY-404"))).toEqual({
        ok: false,
        code: "task_not_found",
      });
    }),
  ),
);

it.scoped("rejects an unsupported lifecycle row hidden by the former actionable predicate", () =>
  withCorruptedTaskState((tasks) =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation("corrupt hidden Task lifecycle", (sql) =>
        Effect.gen(function* () {
          yield* sql.unsafe("PRAGMA ignore_check_constraints = ON");
          yield* sql.unsafe("UPDATE tasks SET state = 'retired' WHERE id = 'BY-1'");
          yield* sql.unsafe("PRAGMA ignore_check_constraints = OFF");
        }),
      );

      yield* expectPersistedDataInvalid(tasks.listActionableTasks());
    }),
  ),
);

it.scoped("rejects unsafe Task ordering identity before next-ID derivation", () =>
  withCorruptedTaskState((tasks) =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation("corrupt Task numeric identity", (sql) =>
        sql.unsafe("UPDATE tasks SET numeric_id = 9007199254740992 WHERE id = 'BY-1'"),
      );

      yield* expectPersistedDataInvalid(
        tasks.createTask({ title: "Next", description: "Next", now: secondNow }),
      );
    }),
  ),
);

it.scoped("rejects a wrong Task scalar primitive before lookup and mutation policy", () =>
  withCorruptedTaskState((tasks) =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation("corrupt Task title primitive", (sql) =>
        sql.unsafe("UPDATE tasks SET title = x'00' WHERE id = 'BY-1'"),
      );

      yield* expectPersistedDataInvalid(tasks.getTaskById(publicTaskId("BY-1")));
      yield* expectPersistedDataInvalid(
        tasks.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow }),
      );
    }),
  ),
);

it.scoped("rejects malformed mutation readback data and rolls back the mutation", () =>
  withCorruptedTaskState((tasks) =>
    Effect.gen(function* () {
      const repository = yield* RepositorySql;
      yield* repository.operation("install corrupting Task mutation trigger", (sql) =>
        sql.unsafe(`
          CREATE TRIGGER corrupt_task_readback
          AFTER UPDATE OF state ON tasks
          BEGIN
            UPDATE tasks SET title = x'00' WHERE id = NEW.id;
          END
        `),
      );

      yield* expectPersistedDataInvalid(
        tasks.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow }),
      );
      expect(yield* tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({
        state: "new",
        title: "Corruption target",
      });
    }),
  ),
);

it.scoped("rejects malformed dependency relationships before Task and Change Start decisions", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const starts = yield* openSqliteChangeStartPersistence();
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "Dependent");
      yield* tasks.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow });
      yield* repository.operation("insert dangling Task dependency", (sql) =>
        Effect.gen(function* () {
          yield* sql.unsafe("PRAGMA foreign_keys = OFF");
          yield* sql.unsafe(`
            INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
            VALUES ('BY-1', ' BY-404')
          `);
          yield* sql.unsafe("PRAGMA foreign_keys = ON");
        }),
      );

      yield* expectPersistedDataInvalid(tasks.listTasks({ includeDone: true }));
      yield* expectPersistedDataInvalid(
        tasks.editTaskDependencies({
          taskId: publicTaskId("BY-1"),
          operation: "add",
          prerequisiteTaskIds: [publicTaskId("BY-404")],
        }),
      );
      yield* expectPersistedDataInvalid(starts.prepareTask(publicTaskId("BY-1")));
    }),
  ),
);

it.scoped("rejects an incomplete linked Implementation Blocker Resolution", () =>
  withTemporaryRepositoryState(({ commonDirectory }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const starts = yield* openSqliteChangeStartPersistence();
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "Context Task");
      yield* tasks.approveTask({ taskId: publicTaskId("BY-1"), now: secondNow });
      const started = yield* starts.create({
        id: "change-malformed-resolution",
        repositoryCommonDirectory: commonDirectory,
        branchRef: "refs/heads/but-why/change-malformed-resolution",
        baseRef: "refs/remotes/origin/main",
        baseRemoteUrl: "https://github.com/acme/repo.git",
        startingCommit: "1111111111111111111111111111111111111111",
        worktreePath: `${commonDirectory}/worktrees/change-malformed-resolution`,
        taskId: publicTaskId("BY-1"),
        now: secondNow,
      });
      if (!started.ok) throw new Error(started.code);
      yield* repository.operation("insert malformed Resolution", (sql) =>
        sql.unsafe(`
        INSERT INTO implementation_blockers (
          id, change_id, reported_at, content, resolved_at,
          resolution_id, resolution_recorded_at, resolution_content
        ) VALUES (
          'blocker-malformed', 'change-malformed-resolution', '${secondNow}', 'Question',
          '${secondNow}', 'resolution-malformed', NULL, 'Partial resolution'
        )
      `),
      );

      yield* expectPersistedDataInvalid(tasks.getTaskContextById(publicTaskId("BY-1")));
    }),
  ),
);

const withCorruptedTaskState = <A, E>(
  use: (tasks: TaskPersistence) => Effect.Effect<A, E, RepositorySql>,
) =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      yield* createTask(tasks, "Corruption target");
      return yield* use(tasks);
    }),
  );

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

const expectPersistedDataInvalid = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(effect);
    expect(error).toMatchObject({ _tag: "RepositoryPersistedDataInvalid" });
  });
