import type { CliEnvironment, CliResult } from "../cli.js";
import type { StructuredErrorInput } from "../cliError.js";
import { repoStateLoadError, runtimeError, success, usageError } from "../cliResults.js";
import { withGlobalHelpFlags } from "../cliHelp.js";
import type { StructuredObject } from "../output/structured.js";
import { hasPublicTaskIdShape, publicTaskId, type PublicTaskId } from "../task/taskId.js";
import {
  loadRepoSubmitPreflight,
  type RepoSubmitPreflight,
  type SubmitTaskResult,
} from "./submitPreflight.js";
import type { ValidationWorkspaceToolingError } from "../validation/createValidationWorkspace.js";

export const routeSubmit = async (
  args: readonly string[],
  environment: CliEnvironment,
): Promise<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return success(submitHelpView());
  }

  const taskIdShape = parseSubmitTaskId(args);

  if (!taskIdShape.ok) {
    return taskIdShape.result;
  }

  const submitPreflight = loadSubmitPreflight(environment.cwd);

  if (!submitPreflight.ok) {
    return submitPreflight.result;
  }

  const taskId = submitPreflight.submit.resolveTaskId(taskIdShape.taskId);

  if (!taskId.ok) {
    return usageError({
      code: "invalid_task_id",
      message: `Invalid Task ID: ${taskIdShape.taskId}`,
      details: { taskId: taskIdShape.taskId, expectedFormat: taskId.expectedFormat },
      help: [taskId.help],
    });
  }

  try {
    const now = environment.now().toISOString();
    const result = submitPreflight.submit.submitTask({
      taskId: taskId.taskId,
      now,
    });

    if (!result.ok) {
      return renderSubmitResult(result);
    }

    const validationWorkspace = await submitPreflight.submit.createValidationWorkspaceForRun({
      runId: result.runId,
      commitSha: result.commitSha,
      taskRecoveryState: result.previousTaskState,
      now,
    });

    if (!validationWorkspace.ok) {
      return validationWorkspaceSetupError(validationWorkspace.toolingError);
    }

    return renderSubmitResult({
      ...result,
      validationWorkspace: validationWorkspace.validationWorkspace,
    });
  } catch {
    return toolingError();
  }
};

const submitHelpView = (): StructuredObject => ({
  usage: "by submit <task-id>",
  arguments: [
    {
      argument: "<task-id>",
      description: "Public Task ID, such as BY-1",
    },
  ],
  flags: withGlobalHelpFlags(),
  examples: ["by submit BY-1"],
});

type SubmitTaskIdArgParseResult =
  | {
      readonly ok: true;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const parseSubmitTaskId = (args: readonly string[]): SubmitTaskIdArgParseResult => {
  const [taskId, extraArg] = args;

  if (taskId === undefined) {
    return {
      ok: false,
      result: usageError({
        code: "missing_task_id",
        message: "Task ID is required.",
        help: ["Run `by submit <task-id>`."],
      }),
    };
  }

  if (extraArg !== undefined) {
    return {
      ok: false,
      result: usageError({
        code: extraArg.startsWith("-") ? "unknown_flag" : "unknown_argument",
        message: `${extraArg.startsWith("-") ? "Unknown flag" : "Unknown argument"}: ${extraArg}`,
        help: ["Run `by submit --help`."],
      }),
    };
  }

  if (!hasPublicTaskIdShape(taskId)) {
    return {
      ok: false,
      result: usageError({
        code: "invalid_task_id",
        message: `Invalid Task ID: ${taskId}`,
        details: { taskId, expectedFormat: "<PREFIX>-<number>" },
        help: ["Use a public Task ID such as BY-1."],
      }),
    };
  }

  return { ok: true, taskId: publicTaskId(taskId) };
};

type SubmitPreflightLoadResult =
  | {
      readonly ok: true;
      readonly submit: RepoSubmitPreflight;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const loadSubmitPreflight = (cwd: string): SubmitPreflightLoadResult => {
  const result = loadRepoSubmitPreflight(cwd);

  if (result.ok) {
    return result;
  }

  return { ok: false, result: repoStateLoadError(result.error) };
};

const renderSubmitResult = (result: SubmitTaskResult): CliResult => {
  if (result.ok) {
    return success({
      submission: {
        taskId: result.taskId,
        runId: result.runId,
        branch: result.branch,
        commitSha: result.commitSha,
        taskState: result.taskState,
        prTarget: {
          owner: result.prTarget.owner,
          repo: result.prTarget.repo,
          baseBranch: result.prTarget.baseBranch,
          remoteName: result.prTarget.remoteName,
          remoteUrl: result.prTarget.remoteUrl,
        },
        ...(result.validationWorkspace === undefined
          ? {}
          : {
              validationWorkspace: {
                tempRefName: result.validationWorkspace.tempRefName,
                submittedSha: result.validationWorkspace.submittedSha,
                worktreeHead: result.validationWorkspace.worktreeHead,
                cleanupResult: {
                  worktree: result.validationWorkspace.cleanupResult.worktree,
                  tempRef: result.validationWorkspace.cleanupResult.tempRef,
                },
              },
            }),
      },
    });
  }

  if (result.kind === "tooling_error") {
    return toolingError();
  }

  return runtimeError(submitPreflightError(result));
};

const submitPreflightError = (
  result: Extract<SubmitTaskResult, { readonly kind: "preflight_rejection" }>,
): StructuredErrorInput => {
  switch (result.code) {
    case "TASK_NOT_FOUND":
      return {
        code: result.code,
        message: `Task was not found: ${result.taskId ?? ""}`,
        details: { taskId: result.taskId ?? "" },
        help: ["Run `by task list --all` to see known Tasks."],
      };
    case "TASK_STATE_NOT_SUBMITTABLE":
      return {
        code: result.code,
        message: `Task ${result.taskId ?? ""} is not submittable from state ${result.state ?? "unknown"}.`,
        details: { taskId: result.taskId ?? "", state: result.state ?? "unknown" },
        help: ["Submit is allowed from implementing or needs_input."],
      };
    case "CURRENT_BRANCH_REQUIRED":
      return {
        code: result.code,
        message: "Submit requires a current branch.",
        help: ["Checkout a non-protected task branch, then rerun `by submit <task-id>`."],
      };
    case "WORKTREE_NOT_CLEAN":
      return {
        code: result.code,
        message: "Worktree must be clean before submit.",
        help: ["Commit, stash, or remove staged, unstaged, and untracked changes."],
      };
    case "PROTECTED_BRANCH":
      return {
        code: result.code,
        message: `Cannot submit protected branch ${result.branch ?? ""}.`,
        details: { branch: result.branch ?? "" },
        help: ["Checkout a non-protected task branch, then rerun submit."],
      };
    case "PR_TARGET_NOT_FOUND":
      return {
        code: result.code,
        message: "Could not detect a GitHub PR target.",
        help: ["Configure a GitHub remote and authenticate GitHub access for this repository."],
      };
    case "BRANCH_ALREADY_BOUND":
      return {
        code: result.code,
        message: `Branch ${result.branch ?? ""} is already bound to task ${result.boundTaskId ?? ""}.`,
        details: { branch: result.branch ?? "", taskId: result.boundTaskId ?? "" },
        help: ["Use the task already bound to this branch, or checkout a different task branch."],
      };
    case "TASK_BRANCH_MISMATCH":
      return {
        code: result.code,
        message: `Task ${result.taskId ?? ""} is bound to branch ${result.boundBranch ?? ""}.`,
        details: {
          taskId: result.taskId ?? "",
          currentBranch: result.branch ?? "",
          boundBranch: result.boundBranch ?? "",
        },
        help: ["Checkout the bound task branch, then rerun submit."],
      };
    case "TASK_HAS_ACTIVE_RUN":
      return {
        code: result.code,
        message: `Task ${result.taskId ?? ""} already has an active Run.`,
        details: { taskId: result.taskId ?? "" },
        help: ["Wait for the active Run to finish before submitting again."],
      };
  }
};

const validationWorkspaceSetupError = (error: ValidationWorkspaceToolingError): CliResult =>
  runtimeError({
    code: "validation_workspace_setup_failed",
    message: "Validation workspace setup failed.",
    details: {
      operationName: error.operationName,
      tempRefName: error.tempRefName,
      submittedSha: error.submittedSha,
      ...(error.worktreePath === undefined ? {} : { worktreePath: error.worktreePath }),
      errorMessage: error.errorMessage,
      cleanupResult: {
        worktree: error.cleanupResult.worktree,
        tempRef: error.cleanupResult.tempRef,
      },
    },
    help: ["Fix the validation workspace setup problem, then rerun submit."],
  });

const toolingError = (): CliResult =>
  runtimeError({
    code: "tooling_error",
    message: "Submit preflight failed unexpectedly.",
    help: ["Check Git, GitHub authentication, and repo-local state, then rerun submit."],
  });
