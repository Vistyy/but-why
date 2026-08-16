import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangeAuthorityPort } from "../../src/sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteTaskPersistence } from "../../src/sqlite/sqliteTaskPersistence.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import { openSqliteTaskChangeLinkPort } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangePersistence.js";
import { openSqliteTaskChangeStartPersistence as openSqliteChangeStartPersistence } from "../../src/taskChange/adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import { queryTaskContext } from "../../src/taskChange/inspectTaskChange.js";
import { passTaskReviewFixture, withTemporaryRepositoryState } from "../support/repository.js";

const firstNow = "2026-08-09T12:00:00.000Z";
const secondNow = "2026-08-09T12:05:00.000Z";

it.scoped("decodes valid current Task states, relationships, Context, and Change Start facts", () =>
  withTemporaryRepositoryState(({ commonDirectory }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const links = yield* openSqliteTaskChangeLinkPort();
      const authority = yield* openSqliteChangeAuthorityPort();
      const starts = yield* openSqliteChangeStartPersistence();
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "New prerequisite");
      yield* createTask(tasks, "Blocked todo", ["BY-1"]);
      yield* createTask(tasks, "Done Task");
      yield* createTask(tasks, "Cancelled Task");
      yield* createTask(tasks, "Task with Resolution");
      yield* passTaskReviewFixture(publicTaskId("BY-2"), secondNow);
      yield* passTaskReviewFixture(publicTaskId("BY-3"), secondNow);
      yield* passTaskReviewFixture(publicTaskId("BY-4"), secondNow);
      yield* passTaskReviewFixture(publicTaskId("BY-5"), secondNow);
      yield* repository.operation("set terminal Task fixtures", (sql) =>
        sql.unsafe(`
          UPDATE tasks
          SET state = CASE id WHEN 'BY-3' THEN 'done' ELSE 'cancelled' END,
              cancel_reason = CASE id WHEN 'BY-4' THEN 'Cancelled fixture' ELSE NULL END
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
        reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
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
      });
      expect(yield* queryTaskContext({ tasks, links, authority }, publicTaskId("BY-5"))).toEqual({
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

it.scoped("rejects malformed Task states selected by Change Start", () =>
  withTemporaryRepositoryState(({ commonDirectory }) =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const starts = yield* openSqliteChangeStartPersistence();
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "Prerequisite");
      yield* createTask(tasks, "Dependent", ["BY-1"]);
      yield* createTask(tasks, "Task with existing Change");
      yield* passTaskReviewFixture(publicTaskId("BY-2"), secondNow);
      yield* passTaskReviewFixture(publicTaskId("BY-3"), secondNow);

      yield* repository.operation("inject malformed prerequisite Task state", (sql) =>
        Effect.gen(function* () {
          yield* sql`PRAGMA ignore_check_constraints = ON`;
          yield* sql`UPDATE tasks SET state = 'unsupported' WHERE id = 'BY-1'`;
        }),
      );
      yield* expectPersistedDataInvalid(starts.prepareTask(publicTaskId("BY-2")));
      yield* repository.operation(
        "restore prerequisite Task state",
        (sql) => sql`UPDATE tasks SET state = 'new' WHERE id = 'BY-1'`,
      );

      const started = yield* starts.create({
        id: "change-with-malformed-task-state",
        repositoryCommonDirectory: commonDirectory,
        branchRef: "refs/heads/but-why/change-with-malformed-task-state",
        baseRef: "refs/remotes/origin/main",
        baseRemoteUrl: "https://github.com/acme/repo.git",
        startingCommit: "1111111111111111111111111111111111111111",
        worktreePath: `${commonDirectory}/worktrees/change-with-malformed-task-state`,
        taskId: publicTaskId("BY-3"),
        now: secondNow,
        reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
      });
      if (!started.ok) throw new Error(started.code);
      yield* repository.operation(
        "inject malformed existing Change Task state",
        (sql) => sql`UPDATE tasks SET state = 'unsupported' WHERE id = 'BY-3'`,
      );
      yield* expectPersistedDataInvalid(starts.prepareTask(publicTaskId("BY-3")));
    }),
  ),
);

it.scoped("rejects a self-referential Task dependency as a graph rule", () =>
  withTemporaryRepositoryState(() =>
    Effect.gen(function* () {
      const tasks = yield* openSqliteTaskPersistence("BY");
      const starts = yield* openSqliteChangeStartPersistence();
      const repository = yield* RepositorySql;
      yield* createTask(tasks, "Self-dependent Task");
      yield* passTaskReviewFixture(publicTaskId("BY-1"), secondNow);
      yield* repository.operation("insert self-referential Task dependency", (sql) =>
        sql.unsafe(`
          INSERT INTO task_dependencies (dependent_task_id, prerequisite_task_id)
          VALUES ('BY-1', 'BY-1')
        `),
      );

      yield* expectPersistedDataInvalid(tasks.listTasks({ includeDone: true }));
      yield* expectPersistedDataInvalid(starts.prepareTask(publicTaskId("BY-1")));
    }),
  ),
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
