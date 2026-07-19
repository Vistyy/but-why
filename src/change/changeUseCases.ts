import { randomUUID } from "node:crypto";

import type { RepoLocalContext } from "../init/repoContext.js";
import {
  runRepositoryPreparation,
  type RepositoryPreparationExecutor,
} from "../repositoryPreparation/runRepositoryPreparation.js";
import { taskSlugForId, type PublicTaskId } from "../task/taskId.js";
import { changeReadiness, changeState, type ChangePrepareFailure } from "./change.js";
import type { ChangeReconciliation, ChangeReconciliationResult } from "./reconcileChange.js";
import {
  provisionChangeWorktree,
  resolveChangeStartGitIntent,
  type ProvisionChangeWorktreeResult,
  type ResolveChangeStartGitResult,
} from "./changeStartGit.js";
import type {
  ChangeStartEligibilityError,
  ChangeStartRecord,
  ChangeStartStore,
} from "./changeStartStore.js";

export type ChangeUseCases = {
  readonly start: (input: {
    readonly taskId?: PublicTaskId;
    readonly now: string;
  }) => Promise<ChangeStartResult>;
  readonly prepare: (changeId: string, now: string) => Promise<ChangePrepareResult>;
  readonly reconcile: (changeId: string | undefined, now: string) => ChangeReconciliationResult;
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
  store: ChangeStartStore,
  executor: RepositoryPreparationExecutor,
  reconciliation: ChangeReconciliation,
): ChangeUseCases => ({
  start: (input) => startChange(context, store, executor, input),
  prepare: (changeId, now) => prepareChange(context, store, executor, changeId, now),
  reconcile: (changeId, now) =>
    reconciliation.reconcile({
      repositoryCommonDirectory: context.commonDirectory,
      ...(changeId === undefined ? {} : { changeId }),
      now,
    }),
});

const startChange = async (
  context: RepoLocalContext,
  store: ChangeStartStore,
  executor: RepositoryPreparationExecutor,
  input: { readonly taskId?: PublicTaskId; readonly now: string },
): Promise<ChangeStartResult> => {
  if (input.taskId !== undefined) {
    const resumed = await resumeTaskChange(context, store, executor, input.taskId, input.now);
    if (resumed !== undefined) return resumed;
  }

  const id = randomUUID();
  const slug = input.taskId === undefined ? `change-${id}` : taskSlugForId(input.taskId);
  const gitIntent = resolveChangeStartGitIntent(context, slug);
  if (!gitIntent.ok) return gitIntent;
  const created = store.create({
    id,
    ...gitIntent.intent,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    now: input.now,
  });
  if (!created.ok) return created;

  const provisioned = provisionChangeWorktree(context.root, created.change, false);
  if (!provisioned.ok) return { ...provisioned, change: created.change };
  return prepareExisting(store, executor, created.change, input.now);
};

const resumeTaskChange = async (
  context: RepoLocalContext,
  store: ChangeStartStore,
  executor: RepositoryPreparationExecutor,
  taskId: PublicTaskId,
  now: string,
): Promise<ChangeStartResult | undefined> => {
  const eligibility = store.prepareTask(taskId);
  if (!eligibility.ok) return eligibility;
  if (eligibility.existing === undefined) return undefined;

  const provisioned = provisionChangeWorktree(context.root, eligibility.existing, true);
  if (!provisioned.ok) return { ...provisioned, change: eligibility.existing };
  return eligibility.existing.readiness === changeReadiness.pending
    ? prepareExisting(store, executor, eligibility.existing, now)
    : readinessResult(eligibility.existing);
};

const prepareChange = async (
  context: RepoLocalContext,
  store: ChangeStartStore,
  executor: RepositoryPreparationExecutor,
  changeId: string,
  now: string,
): Promise<ChangePrepareResult> => {
  const change = store.getById(changeId);
  if (change === undefined) return { ok: false, code: "change_not_found" };
  if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
  const provisioned = provisionChangeWorktree(context.root, change, true);
  if (!provisioned.ok) return { ...provisioned, change };
  if (change.readiness === changeReadiness.ready) return { ok: true, change };
  return prepareExisting(store, executor, change, now);
};

type PreparationResult =
  | { readonly ok: true; readonly change: ChangeStartRecord }
  | { readonly ok: false; readonly code: "prepare_failed"; readonly change: ChangeStartRecord };

const prepareExisting = async (
  store: ChangeStartStore,
  executor: RepositoryPreparationExecutor,
  change: ChangeStartRecord,
  now: string,
): Promise<PreparationResult> => {
  if (change.prepare === null) {
    return { ok: true, change: store.markReady(change.id, now) };
  }

  let failure: ChangePrepareFailure;
  try {
    const result = await runRepositoryPreparation({
      prepare: change.prepare,
      exec: executor,
      cwd: change.worktreePath,
    });
    if (result.exitCode === 0) {
      return { ok: true, change: store.markReady(change.id, now) };
    }
    failure = result;
  } catch (error) {
    failure = {
      command: change.prepare.command,
      exitCode: 1,
      timedOut: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    ok: false,
    code: "prepare_failed",
    change: store.markPrepareFailed(change.id, failure, now),
  };
};

const readinessResult = (change: ChangeStartRecord): ChangeStartResult =>
  change.readiness === changeReadiness.prepareFailed
    ? { ok: false, code: "prepare_failed", change }
    : { ok: true, change };
