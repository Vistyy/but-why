// fallow-ignore-file unused-export -- dynamically imported by the CLI

import type { ChangePrepareResult, ChangeStartResult } from "../../change/changeLifecycle.js";
import type { ChangeStartRecord } from "../../change/changeStartStore.js";
import { type CliResult, runtimeError, success } from "../../cliResults.js";
import { prepareFailureView, remoteChangeBaseError } from "./sharedResults.js";

export const startResult = (result: ChangeStartResult): CliResult => {
  if (result.ok) return success(changeView(result.change));
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
      help: ["Approve the Task before starting its Change."],
    });
  }
  if (result.code === "requested_base_conflict") {
    return runtimeError({
      code: result.code,
      message: "The existing Task-backed Change uses a different Change Base branch.",
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
  return operationalError(result);
};

export const prepareResult = (result: ChangePrepareResult): CliResult => {
  if (result.ok) return success(changeView(result.change));
  if (result.code === "change_not_found" || result.code === "change_not_open") {
    return runtimeError({
      code: result.code,
      message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
      help: ["Use an open Change ID returned by `by change start`."],
    });
  }
  return operationalError(result);
};

export const changeView = (change: ChangeStartRecord) => ({
  change: { id: change.id, taskId: change.taskId },
  branch: change.branchRef,
  baseRef: change.baseRef,
  startingCommit: change.startingCommit,
  worktreePath: change.worktreePath,
  ...(change.prepareFailure === null
    ? {}
    : { prepareFailure: prepareFailureView(change.prepareFailure) }),
});

type OperationalErrorInput = {
  readonly code: string;
  readonly change?: ChangeStartRecord;
  readonly attachedPath?: string;
};

const cancelChangeHelp = (change: ChangeStartRecord | undefined): string =>
  change === undefined
    ? "Or cancel the work with the applicable cancellation command."
    : change.taskId === null
      ? `Or cancel the Change with \`by change cancel ${change.id} --reason "<reason>"\`.`
      : `Or cancel the Task with \`by task cancel ${change.taskId} --reason "<reason>"\`.`;

export const operationalError = (result: OperationalErrorInput): CliResult => {
  const { code, change } = result;
  const identityDetails =
    change === undefined
      ? {}
      : {
          changeId: change.id,
          branch: change.branchRef,
          startingCommit: change.startingCommit,
          worktreePath: change.worktreePath,
        };
  if (code === "managed_branch_missing") {
    return runtimeError({
      code,
      message: "The recorded Repository Branch is missing.",
      details: identityDetails,
      help: [
        `Recover the branch externally, then run \`by change prepare ${change?.id ?? "<change-id>"}\`.`,
        cancelChangeHelp(change),
      ],
    });
  }
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
        cancelChangeHelp(change),
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
        cancelChangeHelp(change),
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
