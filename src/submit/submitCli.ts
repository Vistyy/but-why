import { Effect } from "effect";

import type { CliEnvironment, CliResult } from "../cli.js";
import type { StructuredErrorInput } from "../cliError.js";
import { repoStateLoadError, runtimeError, success } from "../cliResults.js";
import { withGlobalHelpFlags } from "../cliHelp.js";
import {
  parseCliTaskIdArg,
  taskIdResolutionError,
  type CliTaskIdParseResult,
} from "../cliTaskId.js";
import type { StructuredObject } from "../output/structured.js";
import {
  loadLocalSubmitPreflight,
  type LocalSubmitPreflight,
  type SubmitTaskResult,
} from "../localSubmit/submitPreflight.js";
import {
  GlobalConfigValidationFailed,
  InvalidReviewerConfig,
  InvalidSandboxModeFromConfig,
  MissingReviewerProfile,
  RepoConfigValidationFailed,
  type SubmitRejectionError,
} from "../submit/submitRejectionErrors.js";
import {
  validationToolingFailureRecord,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";
import type {
  ValidationWorkspaceSetup,
  ValidationWorkspaceToolingError,
} from "../validation/validationWorkspace.js";

export const routeSubmit = (
  args: readonly string[],
  environment: CliEnvironment,
): Effect.Effect<CliResult> => {
  if (args.length === 1 && args[0] === "--help") {
    return Effect.succeed(success(submitHelpView()));
  }

  return Effect.catchAllDefect(
    Effect.gen(function* () {
      const taskIdParse = parseSubmitTaskId(args);

      if (!taskIdParse.ok) {
        return taskIdParse.result;
      }

      const taskIdResolutionPreflight = loadSubmitPreflight(environment, false);

      if (!taskIdResolutionPreflight.ok) {
        return taskIdResolutionPreflight.result;
      }

      const taskId = taskIdResolutionPreflight.submit.resolveTaskId(taskIdParse.taskId);

      if (!taskId.ok) {
        return taskIdResolutionError(taskId);
      }

      const submitPreflight = loadSubmitPreflight(environment, true);

      if (!submitPreflight.ok) {
        return submitPreflight.result;
      }

      const now = environment.now().toISOString();
      const result = submitPreflight.submit.submitTask({
        taskId: taskId.taskId,
        now,
      });

      if (!result.ok) {
        return renderSubmitResult(result);
      }

      const validationWorkspace =
        yield* submitPreflight.submit.createValidationWorkspaceForValidationRun({
          validationRunId: result.validationRunId,
          commitSha: result.commitSha,
          taskRecoveryState: result.previousTaskState,
          now,
        });

      if (!validationWorkspace.ok) {
        if ("toolingFailure" in validationWorkspace) {
          return validationToolingFailureError(validationWorkspace.toolingFailure);
        }

        return validationWorkspaceSetupError(validationWorkspace.toolingError);
      }

      if (validationWorkspace.activeWorkspaceResult?.checkFindings === 1) {
        return validationFindingsError(result, validationWorkspace.validationWorkspace);
      }

      return renderSubmitResult({
        ...result,
        validationWorkspace: validationWorkspace.validationWorkspace,
      });
    }),
    () => Effect.succeed(toolingError()),
  );
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

const parseSubmitTaskId = (args: readonly string[]): CliTaskIdParseResult =>
  parseCliTaskIdArg(args, {
    missingHelp: "Run `by submit <task-id>`.",
    extraHelp: "Run `by submit --help`.",
    classifyExtraArg: (arg) => (arg.startsWith("-") ? "unknown_flag" : "unknown_argument"),
  });

type SubmitPreflightLoadResult =
  | {
      readonly ok: true;
      readonly submit: LocalSubmitPreflight;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

const loadSubmitPreflight = (
  environment: CliEnvironment,
  requireState: boolean,
): SubmitPreflightLoadResult => {
  const result = loadLocalSubmitPreflight(environment.cwd, {
    requireState,
    migrationTimestamp: () => environment.now().toISOString(),
  });

  if (result.ok) {
    return result;
  }

  if (isSubmitRejectionError(result.error)) {
    return { ok: false, result: runtimeError(submitRejectionLoadError(result.error)) };
  }

  return { ok: false, result: repoStateLoadError(result.error) };
};

const isSubmitRejectionError = (error: unknown): error is SubmitRejectionError =>
  error instanceof RepoConfigValidationFailed ||
  error instanceof GlobalConfigValidationFailed ||
  error instanceof MissingReviewerProfile ||
  error instanceof InvalidReviewerConfig ||
  error instanceof InvalidSandboxModeFromConfig;

const submitRejectionLoadError = (error: SubmitRejectionError): StructuredErrorInput => {
  switch (error._tag) {
    case "RepoConfigValidationFailed":
      return {
        code: "invalid_repo_config",
        message: error.message,
        details: { path: error.path ?? ".but-why/config.json" },
        help: ["Fix the JSON or run `by init --task-prefix <prefix>` after moving it aside."],
      };
    case "GlobalConfigValidationFailed":
      return {
        code: "invalid_global_config",
        message: error.message,
        ...(error.path === undefined ? {} : { details: { path: error.path } }),
        help: ["Fix the global But Why? config, then rerun submit."],
      };
    case "MissingReviewerProfile":
      return {
        code: "missing_reviewer_profile",
        message: `Reviewer profile was not found: ${error.profileName}`,
        details: { profileName: error.profileName },
        help: ["Define the reviewer profile in repo or global config, then rerun submit."],
      };
    case "InvalidReviewerConfig":
      return {
        code: "invalid_reviewer_config",
        message: error.message,
        ...(error.profileName === undefined ? {} : { details: { profileName: error.profileName } }),
        help: ["Fix the reviewer config, then rerun submit."],
      };
    case "InvalidSandboxModeFromConfig":
      return {
        code: "invalid_sandbox_mode",
        message: error.message,
        details: { sandboxMode: error.sandboxMode },
        help: ["Use a supported validation sandbox mode, then rerun submit."],
      };
  }
};

const renderSubmitResult = (result: SubmitTaskResult): CliResult => {
  if (result.ok) {
    return success({
      submission: {
        taskId: result.taskId,
        validationRunId: result.validationRunId,
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

  if (result.kind === "unsupported_task_authority") {
    return unsupportedTaskAuthorityError(result.taskId);
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
    case "TASK_HAS_ACTIVE_VALIDATION_RUN":
      return {
        code: result.code,
        message: `Task ${result.taskId ?? ""} already has an active Validation Run.`,
        details: { taskId: result.taskId ?? "" },
        help: ["Wait for the active Validation Run to finish before submitting again."],
      };
  }
};

const unsupportedTaskAuthorityError = (taskId: string): CliResult =>
  runtimeError({
    code: "TASK_AUTHORITY_UNSUPPORTED",
    message: "Validation start is not supported for this Task Authority.",
    details: { taskId },
    help: ["Use a local But Why? Task for validation start in this version."],
  });

const validationFindingsError = (
  result: Extract<SubmitTaskResult, { readonly ok: true }>,
  validationWorkspace: ValidationWorkspaceSetup,
): CliResult =>
  runtimeError({
    code: "validation_findings",
    message: "Validation produced blocking Findings.",
    details: {
      taskId: result.taskId,
      validationRunId: result.validationRunId,
      taskState: "needs_input",
      validationWorkspace: {
        tempRefName: validationWorkspace.tempRefName,
        submittedSha: validationWorkspace.submittedSha,
        worktreeHead: validationWorkspace.worktreeHead,
        cleanupResult: {
          worktree: validationWorkspace.cleanupResult.worktree,
          tempRef: validationWorkspace.cleanupResult.tempRef,
        },
      },
    },
    help: ["Inspect the latest Validation Run Findings, fix the submission, then rerun submit."],
  });

const validationToolingFailureError = (failure: ValidationToolingFailure): CliResult => {
  const record = validationToolingFailureRecord(failure);

  return runtimeError({
    code: record.errorKind,
    message: "Validation tooling failed.",
    details: {
      operationName: record.operationName,
      errorMessage: record.errorMessage,
    },
    help: ["Fix the validation tooling problem, then rerun submit."],
  });
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
