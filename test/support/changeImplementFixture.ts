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
              INSERT INTO tasks (id, title, description, state)
              VALUES (
                ${numericId},
                ${options.acceptanceContext?.title ?? "Fixture Task"},
                ${options.acceptanceContext?.description ?? ""},
                'todo'
              )
            `,
          );
        }
        yield* repository.operation(
          "create Change Implement fixture",
          (sql) => sql`
            INSERT INTO changes (
              id, branch_ref, base_ref, base_remote_url, worktree_path,
              initial_acceptance_context, reviewer_configuration,
              prepare_definition, prepare_failure, cleanup_pending
            ) VALUES (
              ${internalChangeId(id, "BY")}, 'refs/heads/implement-fixture',
              'refs/remotes/origin/main', 'https://github.com/acme/repo.git', ${worktreePath},
              ${
                options.acceptanceContext === undefined
                  ? null
                  : JSON.stringify({
                      version: 1,
                      title: options.acceptanceContext.title,
                      description: options.acceptanceContext.description,
                    })
              },
              '{"acceptanceReview":null,"specialistReviews":[]}',
              ${
                options.prepareFailure === undefined
                  ? null
                  : JSON.stringify({
                      command: options.prepareFailure.command,
                      timeoutSeconds: 1200,
                    })
              },
              ${
                options.prepareFailure === undefined ? null : JSON.stringify(options.prepareFailure)
              },
              0
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
