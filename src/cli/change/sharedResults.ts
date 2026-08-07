import type { ChangeRecord } from "../../change/change.js";
import type { ChangeStartResult } from "../../change/changeUseCases.js";
import { boundedEvidence } from "../../change/preparationEvidence.js";
import type { ChangeSubmitResult } from "../../change/submitChange.js";
import { type CliResult, runtimeError } from "../../cliResults.js";

export const prepareFailureView = (failure: NonNullable<ChangeRecord["prepareFailure"]>) => ({
  command: failure.command,
  exitCode: failure.exitCode,
  timedOut: failure.timedOut,
  stdout: boundedEvidence(failure.stdout),
  stderr: boundedEvidence(failure.stderr),
});

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
