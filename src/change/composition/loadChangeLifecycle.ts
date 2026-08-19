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
import type { ChangeStartGitOperations } from "../changeStartGitOperations.js";
import { openHerdrInteractiveSessionHost } from "../interactiveSession/adapters/herdrInteractiveSessionHost.js";
import { loadLocalInteractiveSessionProfile } from "../interactiveSession/adapters/localInteractiveSessionProfile.js";
import type { InteractiveSessionHost } from "../interactiveSession/interactiveSessionHost.js";
import { type ChangeReconciliationResult, openChangeReconciliation } from "../reconcileChange.js";
import { resolveChangePolicyAtCommit } from "./resolveChangePolicy.js";
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
  readonly herdrSocketPath?: string;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly platform: NodeJS.Platform;
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
            const git: ChangeStartGitOperations = {
              resolveIntent: (slug, requestedBaseBranch) =>
                resolveChangeStartGitIntent(context, slug, requestedBaseBranch),
              provisionWorktree: (change, recovering, startingCommit) =>
                provisionChangeWorktree(context.root, change, recovering, startingCommit),
            };
            if (command.taskId !== undefined) {
              return yield* taskStart(command);
            }
            return yield* startChange(changes, git, executeLocalRepositoryPreparation, {
              ...command,
              resolvePolicy: (startingCommit) =>
                resolveChangePolicyAtCommit({
                  repositoryRoot: context.root,
                  commit: startingCommit,
                  globalConfigPath: input.globalConfigPath,
                  acceptanceContextSupplied: false,
                  expectedIdPrefix: context.idPrefix,
                }),
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
              provisionWorktree: (change, recovering, startingCommit) =>
                provisionChangeWorktree(context.root, change, recovering, startingCommit),
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
            context.root,
            context.config,
            store,
            input.interactiveSessionHost ??
              openHerdrInteractiveSessionHost(undefined, {
                ...(input.herdrSocketPath === undefined
                  ? {}
                  : { socketPath: input.herdrSocketPath }),
                platform: input.platform,
              }),
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
