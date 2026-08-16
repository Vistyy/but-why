import { Effect } from "effect";
import {
  provisionChangeWorktree,
  resolveChangeStartGitIntent,
} from "../../change/adapters/changeStartGit.js";
import { resolveChangeReviewerConfiguration } from "../../change/composition/resolveChangeReviewerConfiguration.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { executeLocalRepositoryPreparation } from "../../repositoryPreparation/adapters/localRepositoryPreparation.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { openSqliteTaskChangeStartPersistence } from "../adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import {
  startTaskChange,
  type TaskChangeStartInput,
  type TaskChangeStartResult,
} from "../taskChangeStart.js";

export type { TaskChangeStartInput, TaskChangeStartResult } from "../taskChangeStart.js";

export const openTaskChangeStartOperation = (input: {
  readonly context: LocalRepositoryContext;
  readonly globalConfigPath: string;
}) =>
  openSqliteTaskChangeStartPersistence().pipe(
    Effect.map(
      (store) =>
        (
          command: TaskChangeStartInput,
        ): Effect.Effect<TaskChangeStartResult, RepositoryStorageError> =>
          Effect.gen(function* () {
            const reviewerConfiguration = resolveChangeReviewerConfiguration(
              input.context.config,
              input.globalConfigPath,
              input.context.root,
              true,
            );
            if (!reviewerConfiguration.ok) {
              return {
                ok: false as const,
                code: "reviewer_configuration_invalid" as const,
                message: reviewerConfiguration.message,
              };
            }
            const git = {
              resolveIntent: (slug: string, requestedBaseBranch: string | undefined) =>
                resolveChangeStartGitIntent(input.context, slug, requestedBaseBranch),
              provisionWorktree: (
                change: Parameters<typeof provisionChangeWorktree>[1],
                recovering: boolean,
              ) => provisionChangeWorktree(input.context.root, change, recovering),
            };
            return yield* startTaskChange(store, git, executeLocalRepositoryPreparation, {
              ...command,
              reviewerConfiguration: reviewerConfiguration.configuration,
            });
          }),
    ),
  );
