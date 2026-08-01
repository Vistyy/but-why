// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { runtimeError, success, type CliResult } from "../../cliResults.js";
import type { ChangeRecord } from "../../change/change.js";
import type { ChangeStartResult, ChangePrepareResult } from "../../change/changeUseCases.js";
import type { ChangeSubmitResult } from "../../change/submitChange.js";

export const startResult = (result: ChangeStartResult): CliResult => {
  if (result.ok) return success(changeView(result.change));
  if (result.code === "prepare_failed") return prepareFailure(result.change);
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
  return operationalError(result.code, "change" in result ? result.change : undefined);
};

export const prepareResult = (result: ChangePrepareResult): CliResult => {
  if (result.ok) return success(changeView(result.change));
  if (result.code === "prepare_failed") return prepareFailure(result.change);
  if (result.code === "change_not_found" || result.code === "change_not_open") {
    return runtimeError({
      code: result.code,
      message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
      help: ["Use an open Change ID returned by `by change start --json`."],
    });
  }
  return operationalError(result.code, result.change);
};

export const changeView = (change: ChangeRecord) => ({
  change: { id: change.id, taskId: change.taskId, readiness: change.readiness },
  branch: change.branchRef,
  baseRef: change.baseRef,
  startingCommit: change.startingCommit,
  worktreePath: change.worktreePath,
});

export const prepareFailure = (change: ChangeRecord): CliResult => {
  const failure = change.prepareFailure;
  if (failure === null) throw new Error("Prepare-failed Change has no failure evidence");
  return runtimeError({
    code: "prepare_failed",
    message: "Repository Preparation failed; the Change and worktree were preserved.",
    details: {
      changeId: change.id,
      readiness: change.readiness,
      worktreePath: change.worktreePath,
      command: failure.command,
      exitCode: failure.exitCode,
      timedOut: failure.timedOut,
      stdout: boundedEvidence(failure.stdout),
      stderr: boundedEvidence(failure.stderr),
    },
    help: [`Fix the preparation failure, then run \`by change prepare ${change.id}\`.`],
  });
};

export const boundedEvidence = (value: string): string =>
  value.length <= 1000
    ? value
    : `${value.slice(0, 1000)}\n... (truncated, ${value.length} chars total)`;

export const remoteChangeBaseError = (
  result: Extract<
    ChangeStartResult | ChangeSubmitResult,
    {
      readonly code:
        | "publication_remote_missing"
        | "publication_remote_ambiguous"
        | "publication_remote_unreachable"
        | "remote_default_branch_missing"
        | "remote_branch_missing"
        | "invalid_remote_change_base"
        | "publication_remote_changed";
    }
  >,
  operation: "Start" | "Submit",
): CliResult => {
  const details = {
    ...(result.code === "publication_remote_ambiguous" ? { remoteNames: result.remoteNames } : {}),
    ...(result.code === "publication_remote_unreachable" ||
    result.code === "remote_default_branch_missing" ||
    result.code === "remote_branch_missing"
      ? { remoteName: result.remoteName }
      : {}),
    ...(result.code === "remote_branch_missing" ? { branchName: result.branchName } : {}),
    ...(result.code === "invalid_remote_change_base" ? { baseRef: result.baseRef } : {}),
    ...(result.code === "publication_remote_changed"
      ? {
          remoteName: result.remoteName,
          expectedRemoteUrl: result.expectedRemoteUrl,
          actualRemoteUrl: result.actualRemoteUrl,
        }
      : {}),
  };
  return runtimeError({
    code: result.code,
    message: `Change ${operation} could not fetch the selected remote Change Base.`,
    details,
    help: [
      operation === "Start"
        ? "Fix the publication remote or publish the selected branch, then retry Change Start."
        : "Restore the recorded publication remote and branch, then retry Change Submit.",
    ],
  });
};

export const operationalError = (code: string, change?: ChangeRecord): CliResult =>
  runtimeError({
    code,
    message: "Change Start could not create or recover the Managed Worktree.",
    ...(change === undefined
      ? {}
      : {
          details: {
            changeId: change.id,
            branch: change.branchRef,
            startingCommit: change.startingCommit,
            worktreePath: change.worktreePath,
          },
        }),
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
