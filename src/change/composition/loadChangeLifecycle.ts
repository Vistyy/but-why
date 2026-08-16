import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { executeLocalRepositoryPreparation } from "../../repositoryPreparation/adapters/localRepositoryPreparation.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteChangeReconciliationPort } from "../../sqlite/sqliteChangeReconciliationPersistence.js";
import { openSqliteChangeStartPersistence } from "../../sqlite/sqliteChangeStartPersistence.js";
import { openSqliteExecutionLock } from "../../sqlite/sqliteExecutionLock.js";
import { localGitHubPullRequestGateway } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { openSqliteTaskChangeReconciliationCompletion } from "../../taskChange/adapters/sqlite/sqliteTaskChangeCompletionPersistence.js";
import {
  openTaskChangeStartOperation,
  type TaskChangeStartInput,
  type TaskChangeStartResult,
} from "../../taskChange/composition/loadTaskChangeStart.js";
import {
  provisionChangeWorktree,
  resolveChangeStartGitIntent,
  rollbackProvisionedChangeWorktree,
} from "../adapters/changeStartGit.js";
import {
  type ChangeImplementResult,
  type ChangePrepareResult,
  type ChangeStartResult,
  implementChange,
  prepareChange,
  startChange,
} from "../changeLifecycle.js";
import type { ChangeReconciliationPort } from "../changePorts.js";
import { openHerdrInteractiveSessionHost } from "../interactiveSession/adapters/herdrInteractiveSessionHost.js";
import { loadLocalInteractiveSessionProfile } from "../interactiveSession/adapters/localInteractiveSessionProfile.js";
import type { InteractiveSessionHost } from "../interactiveSession/interactiveSessionHost.js";
import { type ChangeReconciliationResult, openChangeReconciliation } from "../reconcileChange.js";
import { resolveChangeReviewerConfiguration } from "./resolveChangeReviewerConfiguration.js";
import { composeTerminalCleanup } from "./terminalCleanup.js";

export type LoadChangeOperationError =
  | ResolveLocalRepositoryError
  | { readonly code: "state_store_unavailable"; readonly idPrefix: string };

export type LoadedChangeOperationResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadChangeOperationError };

type LoadInput = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly interactiveSessionHost?: InteractiveSessionHost;
};

export type UnlinkedChangeStartInput = {
  readonly baseBranch?: string;
  readonly now: string;
  readonly taskId?: never;
};

export type ChangeStartCommand = TaskChangeStartInput | UnlinkedChangeStartInput;

const loadContext = (input: LoadInput) => openRepositoryRuntime(input.cwd);

export const withChangeStart = <A, E, R>(
  input: LoadInput,
  use: (
    start: (
      command: ChangeStartCommand,
    ) => Effect.Effect<ChangeStartResult | TaskChangeStartResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return loaded.runtime.provide(
    Effect.all({
      changes: openSqliteChangeStartPersistence(),
      taskStart: openTaskChangeStartOperation({
        context,
        globalConfigPath: input.globalConfigPath,
      }),
    }).pipe(
      Effect.flatMap(({ changes, taskStart }) =>
        use((command) =>
          Effect.gen(function* () {
            const git = {
              resolveIntent: (slug: string, requestedBaseBranch: string | undefined) =>
                resolveChangeStartGitIntent(context, slug, requestedBaseBranch),
              provisionWorktree: (
                change: Parameters<typeof provisionChangeWorktree>[1],
                recovering: boolean,
              ) => provisionChangeWorktree(context.root, change, recovering),
              rollbackProvisionedWorktree: (
                change: Parameters<typeof provisionChangeWorktree>[1],
              ) => rollbackProvisionedChangeWorktree(context.root, change),
            };
            if (command.taskId !== undefined) {
              return yield* taskStart(command);
            }
            const reviewerConfiguration = resolveChangeReviewerConfiguration(
              context.config,
              input.globalConfigPath,
              context.root,
              false,
            );
            if (!reviewerConfiguration.ok) {
              return {
                ok: false as const,
                code: "reviewer_configuration_invalid" as const,
                message: reviewerConfiguration.message,
              };
            }
            return yield* startChange(changes, git, executeLocalRepositoryPreparation, {
              ...command,
              reviewerConfiguration: reviewerConfiguration.configuration,
            });
          }),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

export const withChangePrepare = <A, E, R>(
  input: LoadInput,
  use: (
    prepare: (
      changeId: string,
      now: string,
    ) => Effect.Effect<ChangePrepareResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return loaded.runtime.provide(
    openSqliteChangeStartPersistence().pipe(
      Effect.flatMap((store) =>
        use((changeId, now) =>
          prepareChange(
            store,
            {
              resolveIntent: (slug, requestedBaseBranch) =>
                resolveChangeStartGitIntent(context, slug, requestedBaseBranch),
              provisionWorktree: (change, recovering) =>
                provisionChangeWorktree(context.root, change, recovering),
              rollbackProvisionedWorktree: (change) =>
                rollbackProvisionedChangeWorktree(context.root, change),
            },
            executeLocalRepositoryPreparation,
            changeId,
            now,
          ),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

export const withChangeImplement = <A, E, R>(
  input: LoadInput,
  use: (
    implement: (
      changeId: string,
      implementerPrompt: string | undefined,
    ) => Effect.Effect<ChangeImplementResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return loaded.runtime.provide(
    openSqliteChangeStartPersistence().pipe(
      Effect.flatMap((store) =>
        use((changeId, implementerPrompt) =>
          implementChange(
            context.mainCheckoutRoot,
            store,
            input.interactiveSessionHost ?? openHerdrInteractiveSessionHost(),
            input.globalConfigPath,
            loadLocalInteractiveSessionProfile,
            changeId,
            implementerPrompt,
          ),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

export const withChangeReconciliation = <A, E, R>(
  input: LoadInput,
  use: (
    reconcile: (
      changeId: string | undefined,
      now: string,
      discardWork?: boolean,
    ) => Effect.Effect<ChangeReconciliationResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  const github = localGitHubPullRequestGateway();
  return loaded.runtime.provide(
    Effect.all({
      reconciliationOwner: openSqliteChangeReconciliationPort(),
      reconciliationCompletion: openSqliteTaskChangeReconciliationCompletion(),
      cleanupTerminal: composeTerminalCleanup(context),
    }).pipe(
      Effect.flatMap(({ reconciliationOwner, reconciliationCompletion, cleanupTerminal }) => {
        const reconciliationStore: ChangeReconciliationPort = {
          getChangeById: reconciliationOwner.getChangeById,
          listChangesForReconciliation: reconciliationOwner.listChangesForReconciliation,
          completeMergedChange: reconciliationCompletion,
        };
        const reconciliation = openChangeReconciliation({
          persistence: reconciliationStore,
          github,
          cleanupTerminal,
          executionLock: openSqliteExecutionLock({ commonDirectory: context.commonDirectory }),
        });
        return use((changeId, now, discardWork) =>
          reconciliation.reconcile({
            repositoryCommonDirectory: context.commonDirectory,
            ...(changeId === undefined ? {} : { changeId }),
            now,
            ...(discardWork === undefined ? {} : { discardWork }),
          }),
        );
      }),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};
