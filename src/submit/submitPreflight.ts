import type { GitHubPrTarget } from "../run/run.js";
import type { TaskState } from "../task/lifecycle.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { ValidationWorkspaceSetup } from "../validation/createValidationWorkspace.js";
import type { StartValidationRunResult, ValidationRuns } from "../validation/validationRuns.js";

import { readGitFacts } from "./gitFacts.js";
import { detectGitHubPrTarget, protectedBranchNames } from "./githubTarget.js";
import type { SubmitReadiness } from "./submitReadiness.js";

/**
 * Future validation workspace code should call this module after implementation work is complete.
 * This module owns submit preflight policy and asks ValidationRuns to start validation atomically.
 */
export type SubmitPreflight = {
  readonly submitTask: (input: SubmitTaskInput) => SubmitTaskResult;
};

export type SubmitTaskInput = {
  readonly taskId: PublicTaskId;
  readonly now: string;
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
      readonly kind: "unsupported_task_authority";
      readonly taskId: PublicTaskId;
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

export const openSubmitPreflight = (input: {
  readonly root: string;
  readonly submitReadiness: SubmitReadiness;
  readonly validationRuns: ValidationRuns;
  readonly allowedUntrackedFiles: readonly string[];
}): SubmitPreflight => ({
  submitTask: (taskInput) =>
    runSubmitPreflight(
      input.root,
      input.submitReadiness,
      input.validationRuns,
      input.allowedUntrackedFiles,
      taskInput,
    ),
});

const runSubmitPreflight = (
  root: string,
  submitReadiness: SubmitReadiness,
  validationRuns: ValidationRuns,
  allowedUntrackedFiles: readonly string[],
  input: SubmitTaskInput,
): SubmitTaskResult => {
  const readiness = submitReadiness.getTaskSubmitReadiness(input.taskId);

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

  const createRun = validationRuns.start({
    taskId: input.taskId,
    branch: gitFacts.facts.branch,
    commitSha: gitFacts.facts.commitSha,
    prTarget: prTarget.target,
    now: input.now,
  });

  if (!createRun.ok) {
    return validationStartRejection(createRun, input.taskId, gitFacts.facts.branch);
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

const validationStartRejection = (
  result: Extract<StartValidationRunResult, { readonly ok: false }>,
  taskId: PublicTaskId,
  branch: string,
): SubmitTaskResult => {
  if (result.code === "TASK_AUTHORITY_UNSUPPORTED") {
    return { ok: false, kind: "unsupported_task_authority", taskId };
  }

  return {
    ok: false,
    kind: "preflight_rejection",
    code: result.code,
    taskId,
    ...(result.state === undefined ? {} : { state: result.state }),
    ...(result.boundBranch === undefined ? {} : { boundBranch: result.boundBranch }),
    ...(result.boundTaskId === undefined ? {} : { boundTaskId: result.boundTaskId }),
    branch,
  };
};
