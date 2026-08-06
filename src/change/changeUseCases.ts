import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { RepoLocalContext } from "../init/repoContext.js";
import {
  type RepositoryPreparationEffectExecutor,
  runRepositoryPreparationEffect,
} from "../repositoryPreparation/runRepositoryPreparation.js";
import { parseRemoteChangeBaseRef } from "../submissionEnvironment/remoteChangeBase.js";
import { type PublicTaskId, taskSlugForId } from "../task/taskId.js";
import { type ChangePrepareFailure, changeState } from "./change.js";
import type {
  ChangeStartGitOperations,
  ProvisionChangeWorktreeFailure,
  ResolveChangeStartGitResult,
} from "./changeStartGitOperations.js";
import type { ChangeStartPersistence } from "./changeStartPersistence.js";
import type { ChangeStartEligibilityError, ChangeStartRecord } from "./changeStartStore.js";
import type { InteractiveSessionHost } from "./interactiveSession/interactiveSessionHost.js";
import type { ChangeImplementResult } from "./interactiveSession/launchInteractiveImplementer.js";
import { launchInteractiveImplementer } from "./interactiveSession/launchInteractiveImplementer.js";
import type { ChangeReconciliation, ChangeReconciliationResult } from "./reconcileChange.js";

export type { ChangeImplementResult };

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
    implementerPrompt: string | undefined,
  ) => Effect.Effect<ChangeImplementResult, RepositoryStorageError>;
  readonly reconcile: (
    changeId: string | undefined,
    now: string,
    discardWork?: boolean,
  ) => Effect.Effect<ChangeReconciliationResult, RepositoryStorageError>;
};

export type ChangeStartResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | ChangeStartEligibilityError
  | Exclude<ResolveChangeStartGitResult, { readonly ok: true }>
  | (ProvisionChangeWorktreeFailure & { readonly change: ChangeStartRecord });

export type ChangePrepareResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | { readonly ok: false; readonly code: "change_not_found" }
  | { readonly ok: false; readonly code: "change_not_open" }
  | (ProvisionChangeWorktreeFailure & { readonly change: ChangeStartRecord });

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
  implement: (changeId, implementerPrompt) =>
    implementChange(
      context,
      store,
      interactiveSessionHost,
      globalConfigPath,
      changeId,
      implementerPrompt,
    ),
  reconcile: (changeId, now, discardWork) =>
    reconciliation.reconcile({
      repositoryCommonDirectory: context.commonDirectory,
      ...(changeId === undefined ? {} : { changeId }),
      now,
      ...(discardWork === undefined ? {} : { discardWork }),
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
    return yield* prepareExisting(store, executor, eligibility.existing, now);
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
    return yield* prepareExisting(store, executor, change, now);
  });

const implementChange = (
  context: RepoLocalContext,
  store: ChangeStartPersistence,
  interactiveSessionHost: InteractiveSessionHost,
  globalConfigPath: string,
  changeId: string,
  implementerPrompt: string | undefined,
): Effect.Effect<ChangeImplementResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const change = yield* store.getById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    return yield* launchInteractiveImplementer({
      context,
      change,
      interactiveSessionHost,
      globalConfigPath,
      implementerPrompt,
    });
  });

type PreparationResult = { readonly ok: true; readonly change: ChangeStartRecord };

const prepareExisting = (
  store: ChangeStartPersistence,
  executor: RepositoryPreparationEffectExecutor,
  change: ChangeStartRecord,
  now: string,
): Effect.Effect<PreparationResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const prepare = change.prepare;
    if (prepare === null) {
      const recorded = yield* store.recordPrepareOutcome(change.id, null, now);
      return { ok: true as const, change: recorded };
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

    const failure =
      outcome.ok && outcome.result.exitCode === 0
        ? null
        : outcome.ok
          ? outcome.result
          : outcome.failure;
    const recorded = yield* store.recordPrepareOutcome(change.id, failure, now);
    return { ok: true as const, change: recorded };
  });
