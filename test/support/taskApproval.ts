import { Effect } from "effect";

import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";

// Models a Task that was approved before Task Submission existed: a New Task is directly
// transitioned to Todo in shared state without fabricating Task Review history.
// Production code has no direct approval path; only tests use this setup seam.
export const transitionTaskToTodo = (taskId: string, now: string) =>
  Effect.gen(function* () {
    const repository = yield* RepositorySql;
    yield* repository.operation("transition Task to todo fixture", (sql) =>
      sql`UPDATE tasks SET state = 'todo', updated_at = ${now} WHERE id = ${taskId}`,
    );
  });

export const transitionTaskToTodoForRepo = (
  root: string,
  taskId: string,
  now = "2026-06-30T12:00:00.000Z",
) =>
  transitionTaskToTodo(taskId, now).pipe(
    Effect.provide(
      repositorySqlLayer({
        commonDirectory: join(root, ".git"),
        statePath: join(root, ".git", "but-why", "state.sqlite"),
      }),
    ),
    Effect.scoped,
  );

import { join } from "node:path";
