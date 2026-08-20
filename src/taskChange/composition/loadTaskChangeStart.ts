import { Effect } from "effect";
import {
  provisionChangeWorktree,
  resolveChangeStartGitIntent,
} from "../../change/adapters/changeStartGit.js";
import type { ChangeStartGitOperations } from "../../change/changeStartGitOperations.js";
import { resolveChangePolicyAtCommit } from "../../change/composition/resolveChangePolicy.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { executeLocalRepositoryPreparation } from "../../repositoryPreparation/adapters/localRepositoryPreparation.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { openSqliteTaskChangeStartPersistence } from "../adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import { taskChangeStartTaskOperations } from "./loadTaskChangePersistence.js";
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
  openSqliteTaskChangeStartPersistence(taskChangeStartTaskOperations).pipe(
    Effect.map(
      (store) =>
        (
          command: TaskChangeStartInput,
        ): Effect.Effect<TaskChangeStartResult, RepositoryStorageError> =>
          Effect.gen(function* () {
            const git: ChangeStartGitOperations = {
              resolveIntent: (requestedBaseBranch) =>
                resolveChangeStartGitIntent(input.context, requestedBaseBranch),
              provisionWorktree: (change, recovering, startingCommit) =>
                provisionChangeWorktree(input.context.root, change, recovering, startingCommit),
            };
            return yield* startTaskChange(
              store,
              git,
              executeLocalRepositoryPreparation,
              command,
              (startingCommit) =>
                resolveChangePolicyAtCommit({
                  repositoryRoot: input.context.root,
                  commit: startingCommit,
                  globalConfigPath: input.globalConfigPath,
                  acceptanceContextSupplied: true,
                  expectedIdPrefix: input.context.idPrefix,
                }),
            );
          }),
    ),
  );
