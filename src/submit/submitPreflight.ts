import { existsSync } from "node:fs";

import {
  loadRepoLocalContext,
  type LoadRepoLocalContextError,
  type RepoLocalContext,
} from "../init/repoContext.js";
import type { GitHubPrTarget } from "../run/run.js";
import type { TaskState } from "../task/lifecycle.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "../task/repoTaskIds.js";
import type { PublicTaskId } from "../task/taskId.js";
import { openRepoState, type RepoState } from "../repoState.js";
import {
  createValidationWorkspace,
  type ValidationWorkspaceSetup,
  type ValidationWorkspaceToolingError,
} from "../validation/createValidationWorkspace.js";
import { readGitFacts } from "./gitFacts.js";
import { detectGitHubPrTarget, protectedBranchNames } from "./githubTarget.js";

/**
 * Future validation workspace code should call this module after implementation work is complete.
 * This module owns submit preflight policy and asks durable Task state to create Runs transactionally.
 */
export type RepoSubmitPreflight = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => RepoTaskIdResolution;
  readonly submitTask: (input: SubmitTaskInput) => SubmitTaskResult;
  readonly createValidationWorkspaceForRun: (
    input: CreateValidationWorkspaceForRunInput,
  ) => Promise<CreateValidationWorkspaceForRunResult>;
};

export type LoadRepoSubmitPreflightResult =
  | {
      readonly ok: true;
      readonly submit: RepoSubmitPreflight;
    }
  | {
      readonly ok: false;
      readonly error: LoadRepoSubmitPreflightError;
    };

export type LoadRepoSubmitPreflightError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type SubmitTaskInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
};

export type CreateValidationWorkspaceForRunInput = {
  readonly runId: string;
  readonly commitSha: string;
  readonly taskRecoveryState: SubmitEligibleState;
  readonly now: string;
};

export type CreateValidationWorkspaceForRunResult =
  | {
      readonly ok: true;
      readonly validationWorkspace: ValidationWorkspaceSetup;
    }
  | {
      readonly ok: false;
      readonly toolingError: ValidationWorkspaceToolingError;
    };

export type SubmitTaskResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
      readonly runId: string;
      readonly branch: string;
      readonly commitSha: string;
      readonly taskState: "validating";
      readonly previousTaskState: SubmitEligibleState;
      readonly prTarget: GitHubPrTarget;
      readonly validationWorkspace?: ValidationWorkspaceSetup;
    }
  | {
      readonly ok: false;
      readonly kind: "preflight_rejection";
      readonly code: SubmitPreflightRejectionCode;
      readonly taskId?: PublicTaskId;
      readonly state?: TaskState;
      readonly branch?: string;
      readonly boundBranch?: string;
      readonly boundTaskId?: string;
    }
  | {
      readonly ok: false;
      readonly kind: "tooling_error";
    };

export type SubmitPreflightRejectionCode =
  | "TASK_NOT_FOUND"
  | "TASK_STATE_NOT_SUBMITTABLE"
  | "CURRENT_BRANCH_REQUIRED"
  | "WORKTREE_NOT_CLEAN"
  | "PROTECTED_BRANCH"
  | "PR_TARGET_NOT_FOUND"
  | "BRANCH_ALREADY_BOUND"
  | "TASK_BRANCH_MISMATCH"
  | "TASK_HAS_ACTIVE_RUN";

export const loadRepoSubmitPreflight = (
  cwd: string,
  input: {
    readonly requireState?: boolean;
    readonly migrationTimestamp: () => string;
  },
): LoadRepoSubmitPreflightResult => {
  const repoContext = loadRepoLocalContext(cwd);

  if (!repoContext.ok) {
    return repoContext;
  }

  if (input.requireState !== false && !existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  return {
    ok: true,
    submit: repoSubmitPreflight(repoContext.context, input.migrationTimestamp),
  };
};

const repoSubmitPreflight = (
  context: RepoLocalContext,
  migrationTimestamp: () => string,
): RepoSubmitPreflight => {
  const state = openRepoState({
    statePath: context.paths.statePath,
    taskPrefix: context.taskPrefix,
    migrationTimestamp,
  });

  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveRepoTaskId(context, taskId),
    submitTask: (input) =>
      runSubmitPreflight(
        context.root,
        state,
        context.config.validationWorkspace?.copyFiles ?? [],
        input,
      ),
    createValidationWorkspaceForRun: (input) =>
      createValidationWorkspaceForRun(context, state, input),
  };
};

const createValidationWorkspaceForRun = async (
  context: RepoLocalContext,
  state: RepoState,
  input: CreateValidationWorkspaceForRunInput,
): Promise<CreateValidationWorkspaceForRunResult> => {
  const result = await createValidationWorkspace({
    repoRoot: context.root,
    runId: input.runId,
    submittedSha: input.commitSha,
    copyFiles: context.config.validationWorkspace?.copyFiles ?? [],
  });

  if (result.ok) {
    state.recordValidationWorkspaceSetup({
      runId: input.runId,
      tempRefName: result.setup.tempRefName,
      submittedSha: result.setup.submittedSha,
      worktreePath: result.setup.worktreePath,
      worktreeHead: result.setup.worktreeHead,
      cleanupWorktree: result.setup.cleanupResult.worktree,
      cleanupTempRef: result.setup.cleanupResult.tempRef,
      now: input.now,
    });

    return { ok: true, validationWorkspace: result.setup };
  }

  state.recordRunToolingError({
    runId: input.runId,
    operationName: result.toolingError.operationName,
    tempRefName: result.toolingError.tempRefName,
    submittedSha: result.toolingError.submittedSha,
    ...(result.toolingError.worktreePath === undefined
      ? {}
      : { worktreePath: result.toolingError.worktreePath }),
    errorMessage: result.toolingError.errorMessage,
    cleanupWorktree: result.toolingError.cleanupResult.worktree,
    cleanupTempRef: result.toolingError.cleanupResult.tempRef,
    taskRecoveryState: input.taskRecoveryState,
    now: input.now,
  });

  return { ok: false, toolingError: result.toolingError };
};

const runSubmitPreflight = (
  root: string,
  state: RepoState,
  allowedUntrackedFiles: readonly string[],
  input: SubmitTaskInput,
): SubmitTaskResult => {
  const readiness = state.getTaskSubmitReadiness(input.taskId);

  if (!readiness.ok) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: readiness.code,
      taskId: input.taskId,
      ...(readiness.code === "TASK_STATE_NOT_SUBMITTABLE" ? { state: readiness.state } : {}),
    };
  }

  const gitFacts = readGitFacts(root, undefined, { allowedUntrackedFiles });

  if (!gitFacts.ok) {
    if (gitFacts.code === "GIT_TOOLING_ERROR") {
      return { ok: false, kind: "tooling_error" };
    }

    return {
      ok: false,
      kind: "preflight_rejection",
      code: gitFacts.code,
      taskId: input.taskId,
    };
  }

  if (protectedBranchNames.has(gitFacts.facts.branch)) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: "PROTECTED_BRANCH",
      taskId: input.taskId,
      branch: gitFacts.facts.branch,
    };
  }

  const prTarget = detectGitHubPrTarget(root, gitFacts.facts.branch);

  if (!prTarget.ok) {
    if (prTarget.code === "GITHUB_TOOLING_ERROR") {
      return { ok: false, kind: "tooling_error" };
    }

    return {
      ok: false,
      kind: "preflight_rejection",
      code: "PR_TARGET_NOT_FOUND",
      taskId: input.taskId,
    };
  }

  if (gitFacts.facts.branch === prTarget.target.baseBranch) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: "PROTECTED_BRANCH",
      taskId: input.taskId,
      branch: gitFacts.facts.branch,
    };
  }

  const createRun = state.createRunFromSubmitPreflight({
    taskId: input.taskId,
    branch: gitFacts.facts.branch,
    commitSha: gitFacts.facts.commitSha,
    prTarget: prTarget.target,
    now: input.now,
  });

  if (!createRun.ok) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: createRun.code,
      taskId: input.taskId,
      ...(createRun.state === undefined ? {} : { state: createRun.state }),
      ...(createRun.boundBranch === undefined ? {} : { boundBranch: createRun.boundBranch }),
      ...(createRun.boundTaskId === undefined ? {} : { boundTaskId: createRun.boundTaskId }),
      branch: gitFacts.facts.branch,
    };
  }

  return {
    ok: true,
    taskId: input.taskId,
    runId: createRun.runId,
    branch: gitFacts.facts.branch,
    commitSha: gitFacts.facts.commitSha,
    taskState: createRun.taskState,
    previousTaskState: createRun.previousTaskState,
    prTarget: prTarget.target,
  };
};
