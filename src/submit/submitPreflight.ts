import type { GitHubPrTarget } from "../run/run.js";
import type { TaskState } from "../task/lifecycle.js";
import type { SubmitEligibleState } from "../task/submitPolicy.js";
import type { PublicTaskId } from "../task/taskId.js";
import type { SubmissionEnvironment } from "../submissionEnvironment/submissionEnvironment.js";
import type {
  TaskAuthority,
  TaskAuthorityStartValidationResult,
} from "../taskAuthority/taskAuthority.js";
import type { ValidationWorkspaceSetup } from "../validation/validationWorkspace.js";

/**
 * Future validation workspace code should call this module after implementation work is complete.
 * This module owns submit preflight policy and starts validation through the TaskAuthority seam.
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
  readonly taskAuthority: TaskAuthority;
  readonly submissionEnvironment: SubmissionEnvironment;
}): SubmitPreflight => ({
  submitTask: (taskInput) => runSubmitPreflight(input, taskInput),
});

const runSubmitPreflight = (
  seams: {
    readonly taskAuthority: TaskAuthority;
    readonly submissionEnvironment: SubmissionEnvironment;
  },
  input: SubmitTaskInput,
): SubmitTaskResult => {
  const readiness = seams.taskAuthority.getTaskSubmitReadiness(input.taskId);

  if (!readiness.ok) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: readiness.code,
      taskId: input.taskId,
      ...(readiness.code === "TASK_STATE_NOT_SUBMITTABLE" ? { state: readiness.state } : {}),
    };
  }

  const submissionCandidate = seams.submissionEnvironment.readSubmittedCodeCandidate();

  if (!submissionCandidate.ok) {
    if (submissionCandidate.kind === "tooling_error") {
      return { ok: false, kind: "tooling_error" };
    }

    return {
      ok: false,
      kind: "preflight_rejection",
      code: submissionCandidate.code,
      taskId: input.taskId,
      ...(submissionCandidate.branch === undefined ? {} : { branch: submissionCandidate.branch }),
    };
  }

  const createRun = seams.taskAuthority.startValidation({
    taskId: input.taskId,
    branch: submissionCandidate.candidate.branch,
    commitSha: submissionCandidate.candidate.commitSha,
    prTarget: submissionCandidate.candidate.prTarget,
    now: input.now,
  });

  if (!createRun.ok) {
    return validationStartRejection(createRun, input.taskId, submissionCandidate.candidate.branch);
  }

  return {
    ok: true,
    taskId: input.taskId,
    runId: createRun.runId,
    branch: submissionCandidate.candidate.branch,
    commitSha: submissionCandidate.candidate.commitSha,
    taskState: createRun.taskState,
    previousTaskState: createRun.previousTaskState,
    prTarget: submissionCandidate.candidate.prTarget,
  };
};

const validationStartRejection = (
  result: Extract<TaskAuthorityStartValidationResult, { readonly ok: false }>,
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
