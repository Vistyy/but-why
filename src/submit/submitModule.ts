import { existsSync } from "node:fs";

import {
  exampleTaskId,
  expectedTaskIdFormat,
  isPublicTaskIdForPrefix,
  loadRepoLocalContext,
  type LoadRepoLocalContextError,
  type RepoLocalContext,
} from "../init/repoContext.js";
import { isSubmittableTaskState, type TaskState } from "../task/task.js";
import type { PublicTaskId } from "../task/taskId.js";
import { readGitFacts } from "./gitPreflight.js";
import { detectGitHubPrTarget, protectedBranchNames, type GitHubPrTarget } from "./githubTarget.js";
import { openDurableSubmitState, type DurableSubmitState } from "./submitStore.js";

export type RepoSubmitModule = {
  readonly taskPrefix: string;
  readonly resolveTaskId: (taskId: PublicTaskId) => SubmitTaskIdResolution;
  readonly submitTask: (input: SubmitTaskInput) => SubmitTaskResult;
};

export type LoadRepoSubmitModuleResult =
  | {
      readonly ok: true;
      readonly submit: RepoSubmitModule;
    }
  | {
      readonly ok: false;
      readonly error: LoadRepoSubmitModuleError;
    };

export type LoadRepoSubmitModuleError =
  | LoadRepoLocalContextError
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

export type SubmitTaskIdResolution =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly expectedFormat: string;
      readonly help: string;
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
      readonly prTarget: GitHubPrTarget;
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

export const loadRepoSubmitModule = (cwd: string): LoadRepoSubmitModuleResult => {
  const repoContext = loadRepoLocalContext(cwd);

  if (!repoContext.ok) {
    return repoContext;
  }

  if (!existsSync(repoContext.context.paths.statePath)) {
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
    submit: repoSubmitModule(repoContext.context),
  };
};

const repoSubmitModule = (context: RepoLocalContext): RepoSubmitModule => {
  const state = openDurableSubmitState({ statePath: context.paths.statePath });

  return {
    taskPrefix: context.taskPrefix,
    resolveTaskId: (taskId) => resolveTaskIdForContext(context, taskId),
    submitTask: (input) => submitTask(context.root, state, input),
  };
};

const submitTask = (
  root: string,
  state: DurableSubmitState,
  input: SubmitTaskInput,
): SubmitTaskResult => {
  const task = state.getTaskForSubmit(input.taskId);

  if (task === undefined) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: "TASK_NOT_FOUND",
      taskId: input.taskId,
    };
  }

  if (!isSubmittableTaskState(task.state)) {
    return {
      ok: false,
      kind: "preflight_rejection",
      code: "TASK_STATE_NOT_SUBMITTABLE",
      taskId: input.taskId,
      state: task.state,
    };
  }

  const gitFacts = readGitFacts(root);

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

  const createRun = state.createRunFromPreflight({
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
    prTarget: prTarget.target,
  };
};

const resolveTaskIdForContext = (
  context: RepoLocalContext,
  taskId: PublicTaskId,
): SubmitTaskIdResolution => {
  if (!isPublicTaskIdForPrefix(taskId, context.taskPrefix)) {
    return {
      ok: false,
      expectedFormat: expectedTaskIdFormat(context.taskPrefix),
      help: `Use a public Task ID such as ${exampleTaskId(context.taskPrefix)}.`,
    };
  }

  return { ok: true, taskId };
};
