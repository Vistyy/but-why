import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { ChangePrepareFailure } from "../../src/change/change.js";
import { internalChangeId } from "../../src/change/changeId.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { internalTaskId } from "../../src/task/taskId.js";
import { withTestRepository } from "./repository.js";

export type ChangeImplementFixtureOptions = {
  readonly taskId?: string;
  readonly acceptanceContext?: { readonly title: string; readonly description: string };
  readonly prepareFailure?: ChangePrepareFailure;
  readonly managedRepoConfig?: unknown;
};

export const createChangeImplementFixture = (
  root: string,
  options: ChangeImplementFixtureOptions = {},
): Effect.Effect<{ readonly id: string; readonly worktreePath: string }, RepositoryStorageError> =>
  Effect.gen(function* () {
    const id = "BY-C1";
    const worktreePath = join(root, "fixture-worktrees", "but-why", id);
    mkdirSync(join(worktreePath, ".but-why"), { recursive: true });
    writeFileSync(
      join(worktreePath, ".but-why", "config.json"),
      `${JSON.stringify(options.managedRepoConfig ?? { idPrefix: "BY" }, null, 2)}\n`,
    );
    yield* withTestRepository(
      root,
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const taskId = options.taskId;
        if (taskId !== undefined) {
          const numericId = Number(/[0-9]+$/u.exec(taskId)?.[0] ?? "1");
          yield* repository.operation(
            "create Change Implement fixture Task for a Change linked to a Task",
            (sql) => sql`
              INSERT INTO tasks (
                id, title, description, state, created_at, updated_at
              ) VALUES (
                ${numericId},
                ${options.acceptanceContext?.title ?? "Fixture Task"},
                ${options.acceptanceContext?.description ?? ""},
                'todo', '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z'
              )
            `,
          );
        }
        yield* repository.operation(
          "create Change Implement fixture",
          (sql) => sql`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, base_ref, base_remote_url,
              starting_commit, worktree_path, acceptance_context,
              prepare_command, prepare_timeout_seconds, prepare_failure,
              state, close_reason, created_at, updated_at, closed_at, cleanup_state
            ) VALUES (
              ${internalChangeId(id, "BY")}, ${join(root, ".git")}, 'refs/heads/implement-fixture',
              'refs/remotes/origin/main', 'https://github.com/acme/repo.git',
              '18fca05273fefafb6a99d64e81d2b698d60e17a4', ${worktreePath},
              ${
                options.acceptanceContext === undefined
                  ? null
                  : JSON.stringify({
                      version: 1,
                      title: options.acceptanceContext.title,
                      description: options.acceptanceContext.description,
                    })
              },
              ${options.prepareFailure?.command ?? null},
              ${options.prepareFailure === undefined ? null : 1200},
              ${
                options.prepareFailure === undefined ? null : JSON.stringify(options.prepareFailure)
              },
              'open', NULL, '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z', NULL, 'complete'
            )
          `,
        );
        if (taskId !== undefined) {
          yield* repository.operation(
            "link Change Implement fixture to its Task",
            (sql) => sql`
              INSERT INTO task_change_links (task_id, change_id)
              VALUES (${internalTaskId(taskId, "BY")}, ${internalChangeId(id, "BY")})
            `,
          );
        }
      }),
    );
    return { id, worktreePath };
  });
