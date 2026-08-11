import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { executeLocalRepositoryPreparation } from "../../repositoryPreparation/adapters/localRepositoryPreparation.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteChangeReconciliationPort } from "../../sqlite/sqliteChangeReconciliationPersistence.js";
import { openSqliteChangeStartPersistence } from "../../sqlite/sqliteChangeStartPersistence.js";
import { localGitHubPullRequestGateway } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
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
import { openHerdrInteractiveSessionHost } from "../interactiveSession/adapters/herdrInteractiveSessionHost.js";
import { loadLocalInteractiveSessionProfile } from "../interactiveSession/adapters/localInteractiveSessionProfile.js";
import type { InteractiveSessionHost } from "../interactiveSession/interactiveSessionHost.js";
import { type ChangeReconciliationResult, openChangeReconciliation } from "../reconcileChange.js";
import { composeTerminalCleanup } from "./terminalCleanup.js";

export type LoadChangeOperationError =
  | ResolveLocalRepositoryError
  | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };

export type LoadedChangeOperationResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadChangeOperationError };

type LoadInput = {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly interactiveSessionHost?: InteractiveSessionHost;
};

const loadContext = (input: LoadInput) => openRepositoryRuntime(input.cwd);

export const withChangeStart = <A, E, R>(
  input: LoadInput,
  use: (
    start: (
      command: Parameters<typeof startChange>[3],
    ) => Effect.Effect<ChangeStartResult, RepositoryStorageError>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<LoadedChangeOperationResult<A>, E | RepositoryStorageError, R> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return loaded.runtime.provide(
    openSqliteChangeStartPersistence().pipe(
      Effect.flatMap((store) =>
        use((command) =>
          startChange(
            store,
            {
              resolveIntent: (slug, requestedBaseBranch) =>
                resolveChangeStartGitIntent(context, slug, requestedBaseBranch),
              provisionWorktree: (change, recovering) =>
                provisionChangeWorktree(context.root, change, recovering),
            },
            executeLocalRepositoryPreparation,
            command,
          ),
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
      reconciliationStore: openSqliteChangeReconciliationPort(),
      cleanupTerminal: composeTerminalCleanup(context),
    }).pipe(
      Effect.flatMap(({ reconciliationStore, cleanupTerminal }) => {
        const reconciliation = openChangeReconciliation({
          persistence: reconciliationStore,
          github,
          cleanupTerminal,
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
