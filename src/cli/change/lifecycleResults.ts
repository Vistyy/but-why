import type { ChangePrepareResult, ChangeStartResult } from "../../change/changeLifecycle.js";
import type { ChangeStartRecord } from "../../change/changeStartStore.js";
import { type CliResult, runtimeError, success } from "../../cliResults.js";
import type { TaskChangeStartResult } from "../../taskChange/taskChangeStart.js";
import { prepareFailureView, remoteChangeBaseError } from "./sharedResults.js";

export const startResult = (result: ChangeStartResult | TaskChangeStartResult): CliResult => {
  if (result.ok) {
    return success(
      isLinkedChangeStartResult(result)
        ? linkedStartChangeView(result.change, result.taskId)
        : unlinkedStartChangeView(result.change),
    );
  }
  if (result.code === "reviewer_configuration_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      help: ["Fix the configured Change reviewers, then run Change Start again."],
    });
  }
  if (result.code === "task_dependencies_unsatisfied") {
    return runtimeError({
      code: result.code,
      message: "The Task has incomplete prerequisites.",
      details: { blockedBy: result.blockedBy },
      help: ["Complete every prerequisite, then run Change Start again."],
    });
  }
  if (result.code === "task_not_found") {
    return runtimeError({
      code: result.code,
      message: "Task was not found.",
      help: ["Run `by task list --all --limit all` to see known Tasks."],
    });
  }
  if (result.code === "invalid_task_state") {
    return runtimeError({
      code: result.code,
      message: `The Task cannot start from state ${result.state}.`,
      details: { state: result.state },
      help: ["Submit the New Task and obtain a passing Task Review before starting its Change."],
    });
  }
  if (result.code === "requested_base_conflict") {
    return runtimeError({
      code: result.code,
      message: "The existing Change linked to a Task uses a different Change Base branch.",
      details: {
        ...(result.requestedBaseBranch === undefined
          ? {}
          : { requestedBaseBranch: result.requestedBaseBranch }),
        ...(result.recordedBaseBranch === undefined
          ? {}
          : { recordedBaseBranch: result.recordedBaseBranch }),
      },
      help: ["Retry Change Start without --base and continue the existing Change."],
    });
  }
  if (
    result.code === "publication_remote_missing" ||
    result.code === "publication_remote_ambiguous" ||
    result.code === "publication_remote_unreachable" ||
    result.code === "remote_default_branch_missing" ||
    result.code === "remote_branch_missing" ||
    result.code === "invalid_remote_change_base" ||
    result.code === "publication_remote_changed"
  ) {
    return remoteChangeBaseError(result, "Start");
  }
  return operationalError(result, isLinkedChangeStartResult(result) ? "task-change" : "change");
};

export const prepareResult = (result: ChangePrepareResult): CliResult => {
  if (result.ok) return success(unlinkedPrepareChangeView(result.change));
  if (result.code === "change_not_found" || result.code === "change_not_open") {
    return runtimeError({
      code: result.code,
      message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
      help: ["Use an open Change ID returned by `by change start`."],
    });
  }
  return operationalError(result, "change");
};

type LinkedChangeStartResult = Extract<TaskChangeStartResult, { readonly taskId: string }>;

const isLinkedChangeStartResult = (
  result: ChangeStartResult | TaskChangeStartResult,
): result is LinkedChangeStartResult => "taskId" in result && result.taskId !== undefined;

const changeDetails = (change: ChangeStartRecord) => ({
  branch: change.branchRef,
  baseRef: change.baseRef,
  worktreePath: change.worktreePath,
  ...(change.prepareFailure === null
    ? {}
    : { prepareFailure: prepareFailureView(change.prepareFailure) }),
});

const unlinkedStartChangeView = (change: ChangeStartRecord) => ({
  change: { id: change.id, taskId: null },
  ...changeDetails(change),
});

const unlinkedPrepareChangeView = (change: ChangeStartRecord) => ({
  change: { id: change.id },
  ...changeDetails(change),
});

const linkedStartChangeView = (change: ChangeStartRecord, taskId: string) => ({
  change: { id: change.id, taskId },
  ...changeDetails(change),
});

type OperationalErrorInput = {
  readonly code: string;
  readonly change?: ChangeStartRecord;
  readonly taskId?: string;
  readonly attachedPath?: string;
};

type OperationalErrorContext = "change" | "task-change";

const cancelChangeHelp = (
  change: ChangeStartRecord | undefined,
  taskId: string | undefined,
  context: OperationalErrorContext,
): string =>
  change === undefined || taskId === undefined || context === "change"
    ? change === undefined
      ? "Or cancel the work with the applicable cancellation command."
      : `Or cancel the Change with \`by change cancel ${change.id} --reason "<reason>"\`.`
    : `Or cancel the Task with \`by task cancel ${taskId} --reason "<reason>"\`.`;

const operationalError = (
  result: OperationalErrorInput,
  context: OperationalErrorContext,
): CliResult => {
  const { code, change, taskId } = result;
  const identityDetails =
    change === undefined
      ? {}
      : {
          changeId: change.id,
          branch: change.branchRef,
          worktreePath: change.worktreePath,
        };
  if (code === "managed_branch_attached") {
    return runtimeError({
      code,
      message: "The recorded Repository Branch is attached to another worktree.",
      details: {
        ...identityDetails,
        ...(result.attachedPath === undefined ? {} : { attachedPath: result.attachedPath }),
      },
      help: [
        `Remove or relocate the worktree that holds the branch, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
        cancelChangeHelp(change, taskId, context),
      ],
    });
  }
  if (code === "managed_branch_missing") {
    return runtimeError({
      code,
      message: "The recorded Repository Branch is missing.",
      details: identityDetails,
      help: [
        `Recover the recorded branch externally, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
        cancelChangeHelp(change, taskId, context),
      ],
    });
  }
  if (code === "managed_worktree_path_conflict") {
    return runtimeError({
      code,
      message: "The recorded Managed Worktree path contains conflicting files.",
      details: identityDetails,
      help: [
        `Move the conflicting files aside or remove them, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
        cancelChangeHelp(change, taskId, context),
      ],
    });
  }
  return runtimeError({
    code,
    message: "Change Start could not create or recover the Managed Worktree.",
    ...(change === undefined ? {} : { details: identityDetails }),
    help:
      code === "managed_worktree_path_unavailable"
        ? [
            `Make the parent directory writable, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
            `Create the expected directory with suitable ownership, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
            "Move the repository to a writable parent, then start a new Change.",
          ]
        : [
            "Inspect the default branch, committed Repo Config, branch, and worktree path, then retry.",
          ],
  });
};
