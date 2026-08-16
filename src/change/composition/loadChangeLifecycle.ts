import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { readGlobalConfig } from "../../init/adapters/globalConfig.js";
import { executeLocalRepositoryPreparation } from "../../repositoryPreparation/adapters/localRepositoryPreparation.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteChangeReconciliationPort } from "../../sqlite/sqliteChangeReconciliationPersistence.js";
import { openSqliteChangeStartPersistence } from "../../sqlite/sqliteChangeStartPersistence.js";
import { openSqliteTaskChangeStartPersistence } from "../../taskChange/adapters/sqlite/sqliteTaskChangeStartPersistence.js";
import { openSqliteExecutionLock } from "../../sqlite/sqliteExecutionLock.js";
import { localGitHubPullRequestGateway } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { resolveAcceptanceReviewPolicy } from "../acceptanceReview/acceptanceReviewConfig.js";
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
import type { ChangeReviewerConfiguration } from "../changeStartStore.js";
import { openHerdrInteractiveSessionHost } from "../interactiveSession/adapters/herdrInteractiveSessionHost.js";
import { loadLocalInteractiveSessionProfile } from "../interactiveSession/adapters/localInteractiveSessionProfile.js";
import type { InteractiveSessionHost } from "../interactiveSession/interactiveSessionHost.js";
import { type ChangeReconciliationResult, openChangeReconciliation } from "../reconcileChange.js";
import { resolveSpecialistReviewPolicies } from "../specialistReview/specialistReviewConfig.js";
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
    openSqliteTaskChangeStartPersistence().pipe(
      Effect.flatMap((store) =>
        use((command) =>
          Effect.gen(function* () {
            const taskPreparation =
              command.taskId === undefined ? undefined : yield* store.prepareTask(command.taskId);
            const git = {
              resolveIntent: (slug: string, requestedBaseBranch: string | undefined) =>
                resolveChangeStartGitIntent(context, slug, requestedBaseBranch),
              provisionWorktree: (
                change: Parameters<typeof provisionChangeWorktree>[1],
                recovering: boolean,
              ) => provisionChangeWorktree(context.root, change, recovering),
            };
            if (
              taskPreparation !== undefined &&
              (!taskPreparation.ok || taskPreparation.existing !== undefined)
            ) {
              return yield* startChange(store, git, executeLocalRepositoryPreparation, command);
            }
            const reviewerConfiguration = resolveChangeReviewerConfiguration(
              context.config,
              input.globalConfigPath,
              context.root,
              command.taskId !== undefined,
            );
            if (!reviewerConfiguration.ok) {
              return {
                ok: false as const,
                code: "reviewer_configuration_invalid" as const,
                message: reviewerConfiguration.message,
              };
            }
            return yield* startChange(store, git, executeLocalRepositoryPreparation, {
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

const resolveChangeReviewerConfiguration = (
  repoConfig: Parameters<typeof resolveSpecialistReviewPolicies>[0]["repoConfig"] | undefined,
  globalConfigPath: string,
  repoRoot: string,
  acceptanceContextSupplied: boolean,
):
  | { readonly ok: true; readonly configuration: ChangeReviewerConfiguration }
  | { readonly ok: false; readonly message: string } => {
  if (repoConfig === undefined) {
    return {
      ok: false,
      message: "Repo Config is required to resolve Change reviewer configuration.",
    };
  }
  const globalConfig = readGlobalConfig(globalConfigPath);
  if (!globalConfig.ok) return { ok: false, message: globalConfig.error.message };
  const specialists = resolveSpecialistReviewPolicies({
    repoConfig,
    globalConfig: globalConfig.config,
    repoRoot,
    globalConfigPath,
  });
  if (!specialists.ok) return { ok: false, message: specialists.error.message };
  const acceptance = acceptanceContextSupplied
    ? resolveAcceptanceReviewPolicy({
        repoConfig,
        globalConfig: globalConfig.config,
        repoRoot,
        globalConfigPath,
      })
    : { ok: true as const, policy: null };
  if (!acceptance.ok) return { ok: false, message: acceptance.error.message };
  return {
    ok: true,
    configuration: {
      acceptanceReview:
        acceptance.policy === null ? null : snapshotReviewerPolicy(acceptance.policy),
      specialistReviews: specialists.policies.map(snapshotReviewerPolicy),
    },
  };
};

const snapshotReviewerPolicy = <
  Policy extends { readonly profile: { readonly globalConfigDirectory?: string } },
>(
  policy: Policy,
): Policy => ({
  ...policy,
  profile: {
    ...policy.profile,
    ...(policy.profile.globalConfigDirectory === undefined
      ? {}
      : { globalConfigDirectory: policy.profile.globalConfigDirectory }),
  },
});

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
