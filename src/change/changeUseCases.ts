import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { Effect } from "effect";

import { repoAgentEnvironment } from "../agent/agentEnvironment.js";
import { resolveInteractiveSessionAgentProfile } from "../agent/agentProfiles.js";
import type { RepoLocalContext } from "../init/repoContext.js";
import { readGlobalConfig } from "../init/globalConfig.js";
import { readRepoConfig } from "../init/repoConfig.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { parseRemoteChangeBaseRef } from "../submissionEnvironment/remoteChangeBase.js";
import {
  runRepositoryPreparationEffect,
  type RepositoryPreparationEffectExecutor,
} from "../repositoryPreparation/runRepositoryPreparation.js";
import { taskSlugForId, type PublicTaskId } from "../task/taskId.js";
import { changeReadiness, changeState, type ChangePrepareFailure } from "./change.js";
import type {
  InteractiveSessionHost,
  InteractiveSessionLaunchEvidence,
} from "./interactiveSessionHost.js";
import { buildImplementerPrompt } from "./implementerPrompt.js";
import type { ChangeReconciliation, ChangeReconciliationResult } from "./reconcileChange.js";
import type {
  ChangeStartGitOperations,
  ProvisionChangeWorktreeResult,
  ResolveChangeStartGitResult,
} from "./changeStartGitOperations.js";
import type { ChangeStartPersistence } from "./changeStartPersistence.js";
import type { ChangeStartEligibilityError, ChangeStartRecord } from "./changeStartStore.js";

export type ChangeUseCases = {
  readonly start: (input: {
    readonly taskId?: PublicTaskId;
    readonly baseBranch?: string;
    readonly now: string;
  }) => Effect.Effect<ChangeStartResult, RepositoryStorageError>;
  readonly prepare: (
    changeId: string,
    now: string,
  ) => Effect.Effect<ChangePrepareResult, RepositoryStorageError>;
  readonly implement: (
    changeId: string,
    initialPrompt: string | undefined,
  ) => Effect.Effect<ChangeImplementResult, RepositoryStorageError>;
  readonly reconcile: (
    changeId: string | undefined,
    now: string,
  ) => Effect.Effect<ChangeReconciliationResult, RepositoryStorageError>;
};

export type ChangeStartResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | ChangeStartEligibilityError
  | Exclude<ResolveChangeStartGitResult, { readonly ok: true }>
  | {
      readonly ok: false;
      readonly code: Exclude<ProvisionChangeWorktreeResult, { readonly ok: true }>["code"];
      readonly change: ChangeStartRecord;
    }
  | { readonly ok: false; readonly code: "prepare_failed"; readonly change: ChangeStartRecord };

export type ChangeImplementResult =
  | {
      readonly ok: true;
      readonly change: ChangeStartRecord;
      readonly host: "herdr";
      readonly status: "started" | "already_active";
      readonly agentProfile?: string;
      readonly profileScope?: "repo" | "global";
    }
  | {
      readonly ok: false;
      readonly change: ChangeStartRecord;
      readonly code:
        | "host_unavailable"
        | "launch_failed"
        | "launch_indeterminate"
        | "agent_environment_invalid"
        | "agent_profile_invalid";
      readonly message: string;
      readonly evidence?: InteractiveSessionLaunchEvidence;
    }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_open" }
  | { readonly ok: false; readonly code: "change_not_ready"; readonly change: ChangeStartRecord };

export type ChangePrepareResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | { readonly ok: false; readonly code: "change_not_found" }
  | { readonly ok: false; readonly code: "change_not_open" }
  | {
      readonly ok: false;
      readonly code: Exclude<ProvisionChangeWorktreeResult, { readonly ok: true }>["code"];
      readonly change: ChangeStartRecord;
    }
  | { readonly ok: false; readonly code: "prepare_failed"; readonly change: ChangeStartRecord };

export const openChangeUseCases = (
  context: RepoLocalContext,
  store: ChangeStartPersistence,
  git: ChangeStartGitOperations,
  executor: RepositoryPreparationEffectExecutor,
  reconciliation: ChangeReconciliation,
  interactiveSessionHost: InteractiveSessionHost,
  globalConfigPath: string,
): ChangeUseCases => ({
  start: (input) => startChange(store, git, executor, input),
  prepare: (changeId, now) => prepareChange(store, git, executor, changeId, now),
  implement: (changeId, initialPrompt) =>
    implementChange(
      context,
      store,
      interactiveSessionHost,
      globalConfigPath,
      changeId,
      initialPrompt,
    ),
  reconcile: (changeId, now) =>
    reconciliation.reconcile({
      repositoryCommonDirectory: context.commonDirectory,
      ...(changeId === undefined ? {} : { changeId }),
      now,
    }),
});

const startChange = (
  store: ChangeStartPersistence,
  git: ChangeStartGitOperations,
  executor: RepositoryPreparationEffectExecutor,
  input: { readonly taskId?: PublicTaskId; readonly baseBranch?: string; readonly now: string },
): Effect.Effect<ChangeStartResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (input.taskId !== undefined) {
      const resumed = yield* resumeTaskChange(
        store,
        git,
        executor,
        input.taskId,
        input.baseBranch,
        input.now,
      );
      if (resumed !== undefined) return resumed;
    }

    const id = randomUUID();
    const slug = input.taskId === undefined ? `change-${id}` : taskSlugForId(input.taskId);
    const gitIntent = git.resolveIntent(slug, input.baseBranch);
    if (!gitIntent.ok) return gitIntent;
    const created = yield* store.create({
      id,
      ...gitIntent.intent,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      now: input.now,
    });
    if (!created.ok) return created;

    const provisioned = git.provisionWorktree(created.change, false);
    if (!provisioned.ok) return { ...provisioned, change: created.change };
    return yield* prepareExisting(store, executor, created.change, input.now);
  });

const resumeTaskChange = (
  store: ChangeStartPersistence,
  git: ChangeStartGitOperations,
  executor: RepositoryPreparationEffectExecutor,
  taskId: PublicTaskId,
  requestedBaseBranch: string | undefined,
  now: string,
): Effect.Effect<ChangeStartResult | undefined, RepositoryStorageError> =>
  Effect.gen(function* () {
    const eligibility = yield* store.prepareTask(taskId);
    if (!eligibility.ok) return eligibility;
    if (eligibility.existing === undefined) return undefined;
    const recordedBaseBranch = parseRemoteChangeBaseRef(eligibility.existing.baseRef)?.branchName;
    if (requestedBaseBranch !== undefined && requestedBaseBranch !== recordedBaseBranch) {
      return {
        ok: false,
        code: "requested_base_conflict",
        requestedBaseBranch,
        ...(recordedBaseBranch === undefined ? {} : { recordedBaseBranch }),
      } as const;
    }

    const provisioned = git.provisionWorktree(eligibility.existing, true);
    if (!provisioned.ok) return { ...provisioned, change: eligibility.existing };
    return eligibility.existing.readiness === changeReadiness.pending
      ? yield* prepareExisting(store, executor, eligibility.existing, now)
      : readinessResult(eligibility.existing);
  });

const prepareChange = (
  store: ChangeStartPersistence,
  git: ChangeStartGitOperations,
  executor: RepositoryPreparationEffectExecutor,
  changeId: string,
  now: string,
): Effect.Effect<ChangePrepareResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* store.getById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    const provisioned = git.provisionWorktree(change, true);
    if (!provisioned.ok) return { ...provisioned, change };
    if (change.readiness === changeReadiness.ready) return { ok: true, change };
    return yield* prepareExisting(store, executor, change, now);
  });

const implementChange = (
  context: RepoLocalContext,
  store: ChangeStartPersistence,
  interactiveSessionHost: InteractiveSessionHost,
  globalConfigPath: string,
  changeId: string,
  handoff: string | undefined,
): Effect.Effect<ChangeImplementResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* store.getById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    if (change.readiness !== changeReadiness.ready) {
      return { ok: false, code: "change_not_ready", change };
    }
    const managedRepoConfig = readRepoConfig(join(change.worktreePath, ".but-why", "config.json"));
    if (!managedRepoConfig.ok) {
      return {
        ok: false,
        code: "agent_environment_invalid",
        message: `Managed Worktree Repo Config is invalid: ${managedRepoConfig.error.message}`,
        change,
      };
    }
    const globalConfig = readGlobalConfig(globalConfigPath);
    if (!globalConfig.ok) {
      return {
        ok: false,
        code: "agent_profile_invalid",
        message: `Global Config is invalid: ${globalConfig.error.message}`,
        change,
      };
    }
    const agentProfile = resolveInteractiveSessionAgentProfile({
      repoConfig: managedRepoConfig.config,
      globalConfig: globalConfig.config,
      globalConfigDirectory: dirname(globalConfigPath),
    });
    if (!agentProfile.ok) {
      return {
        ok: false,
        code: "agent_profile_invalid",
        message: agentProfileErrorMessage(agentProfile.error),
        change,
      };
    }
    const resolvedAgentProfile = agentProfile.profile;
    if (resolvedAgentProfile === undefined) {
      return {
        ok: false,
        code: "agent_profile_invalid",
        message: "Interactive Session Agent Profile is not configured.",
        change,
      };
    }
    const agentEnvironment = repoAgentEnvironment(managedRepoConfig.config);
    const launched = yield* Effect.tryPromise({
      try: (signal) =>
        interactiveSessionHost.launch(
          {
            changeId: change.id,
            repositoryPath: context.mainCheckoutRoot,
            worktreePath: change.worktreePath,
            initialPrompt: buildImplementerPrompt({
              changeId: change.id,
              worktreePath: change.worktreePath,
              ...(handoff === undefined ? {} : { handoff }),
            }),
            agentProfile: resolvedAgentProfile,
            globalConfigDirectory: dirname(globalConfigPath),
            ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
          },
          signal,
        ),
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    }).pipe(
      Effect.match({
        onFailure: (message) => ({ ok: false as const, message }),
        onSuccess: (result) => ({ ok: true as const, result }),
      }),
    );
    return launched.ok
      ? {
          change,
          ...launched.result,
          agentProfile: resolvedAgentProfile.agentProfile,
          profileScope: resolvedAgentProfile.scope,
        }
      : { ok: false, code: "launch_failed", message: launched.message, change };
  });

const agentProfileErrorMessage = (error: {
  readonly _tag: string;
  readonly profileName?: string;
  readonly scope?: "repo" | "global";
  readonly agentRuntime?: string;
}): string => {
  const profile = `Interactive Session Agent Profile "${error.profileName ?? "<missing>"}"`;
  const scope = error.scope === undefined ? "" : ` in ${error.scope} scope`;
  if (error._tag === "MissingAgentProfile") {
    return `${profile}${scope} was not found.`;
  }
  if (error._tag === "MissingAgentModel") {
    return `${profile}${scope} has no Pi model in runtimeConfig.`;
  }
  return `${profile}${scope} must use the Pi agent runtime; it uses "${error.agentRuntime ?? "unknown"}".`;
};

type PreparationResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | { readonly ok: false; readonly code: "prepare_failed"; readonly change: ChangeStartRecord };

const prepareExisting = (
  store: ChangeStartPersistence,
  executor: RepositoryPreparationEffectExecutor,
  change: ChangeStartRecord,
  now: string,
): Effect.Effect<PreparationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const prepare = change.prepare;
    if (prepare === null) {
      const ready = yield* store.markReady(change.id, now);
      return { ok: true as const, change: ready };
    }

    const outcome = yield* runRepositoryPreparationEffect({
      prepare,
      exec: executor,
      cwd: change.worktreePath,
    })
      .pipe(
        Effect.mapError(
          (error): ChangePrepareFailure => ({
            command: prepare.command,
            exitCode: 1,
            timedOut: false,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          }),
        ),
      )
      .pipe(
        Effect.match({
          onFailure: (failure) => ({ ok: false as const, failure }),
          onSuccess: (result) => ({ ok: true as const, result }),
        }),
      );

    if (outcome.ok && outcome.result.exitCode === 0) {
      const ready = yield* store.markReady(change.id, now);
      return { ok: true as const, change: ready };
    }
    const failure = outcome.ok ? outcome.result : outcome.failure;
    const failed = yield* store.markPrepareFailed(change.id, failure, now);
    return { ok: false as const, code: "prepare_failed" as const, change: failed };
  });

const readinessResult = (change: ChangeStartRecord): ChangeStartResult =>
  change.readiness === changeReadiness.prepareFailed
    ? { ok: false, code: "prepare_failed", change }
    : { ok: true, change };
