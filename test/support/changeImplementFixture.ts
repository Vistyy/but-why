import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect } from "effect";

import type { ChangePrepareFailure } from "../../src/change/change.js";
import type { RepositoryStorageError } from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
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
    const id = randomUUID();
    const worktreePath = join(root, "fixture-worktrees", "but-why", `change-${id.slice(0, 8)}`);
    mkdirSync(join(worktreePath, ".but-why"), { recursive: true });
    writeFileSync(
      join(worktreePath, ".but-why", "config.json"),
      `${JSON.stringify(options.managedRepoConfig ?? { taskPrefix: "BY" }, null, 2)}\n`,
    );
    yield* withTestRepository(
      root,
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        if (options.taskId !== undefined) {
          const numericId = Number(/[0-9]+$/u.exec(options.taskId)?.[0] ?? "1");
          yield* repository.operation(
            "create Change Implement fixture Task for a Change linked to a Task",
            (sql) => sql`
              INSERT INTO tasks (
                id, numeric_id, title, description, state, created_at, updated_at
              ) VALUES (
                ${options.taskId}, ${numericId},
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
              id, repository_common_directory, branch_ref, base_ref, base_remote_url, task_id,
              starting_commit, worktree_path, acceptance_context,
              prepare_command, prepare_timeout_seconds, prepare_failure,
              state, close_reason, created_at, updated_at, closed_at, cleanup_state
            ) VALUES (
              ${id}, ${join(root, ".git")}, 'refs/heads/implement-fixture',
              'refs/remotes/origin/main', 'https://github.com/acme/repo.git',
              ${options.taskId ?? null},
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
      }),
    );
    return { id, worktreePath };
  });
