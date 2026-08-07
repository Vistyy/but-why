import type { ChangeCancellationResult } from "../../change/cancelChange.js";
import { type CliResult, runtimeError, success } from "../../cliResults.js";

export const changeCancelResult = (result: ChangeCancellationResult): CliResult => {
  if (result.ok) {
    return success({
      status: result.status,
      changed: result.changed,
      change: {
        id: result.change.id,
        state: result.change.state,
        closeReason: result.change.closeReason,
        cleanup: result.change.cleanup,
        ...(result.change.cancelReason === null
          ? {}
          : { cancelReason: result.change.cancelReason }),
      },
      ...(result.task === null
        ? {}
        : {
            task: {
              id: result.task.id,
              state: result.task.state,
              ...(result.task.cancelReason === null
                ? {}
                : { cancelReason: result.task.cancelReason }),
            },
          }),
    });
  }
  if (result.code === "change_not_found") {
    return runtimeError({
      code: result.code,
      message: "Change was not found.",
      details: { changeId: result.changeId },
      help: ["Use a Change ID returned by `by change start --json`."],
    });
  }
  if (result.code === "submission_in_progress") {
    return runtimeError({
      code: result.code,
      message: "Another Submission or cancellation already owns this Change.",
      details: { changeId: result.changeId },
      help: ["Wait for the other operation to finish, then retry."],
    });
  }
  if (result.code === "active_validation_run") {
    return runtimeError({
      code: result.code,
      message: `Validation Run ${result.validationRunId} remains active for this Change.`,
      details: {
        changeId: result.changeId,
        ...(result.validationRunId === undefined
          ? {}
          : { validationRunId: result.validationRunId }),
      },
      help: [
        `After stopping every process from the run, execute \`by validation-run abandon ${result.validationRunId} --reason <reason>\`.`,
      ],
    });
  }
  if (result.code === "github_close_failed") {
    return runtimeError({
      code: result.code,
      message: "The owned pull request could not be closed, so the Change remains open.",
      details: { changeId: result.changeId },
      help: ["Resolve the GitHub issue, then retry Change Cancel."],
    });
  }
  if (result.code === "github_pull_request_unavailable") {
    return runtimeError({
      code: result.code,
      message: "The owned pull request could not be read, so the Change remains open.",
      details: { changeId: result.changeId },
      help: ["Restore GitHub access, then retry Change Cancel."],
    });
  }
  if (result.code === "owned_pull_request_mismatch") {
    return runtimeError({
      code: result.code,
      message: "The owned pull request does not match the recorded Change facts.",
      details: { changeId: result.changeId },
      help: ["Inspect the Change and resolve the remote mismatch before retrying."],
    });
  }
  return runtimeError({
    code: result.code,
    message: "The Change was already completed and cannot be cancelled.",
    details: { changeId: result.changeId },
    help: ["Inspect the Change with `by change show <change-id>`."],
  });
};
