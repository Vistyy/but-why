// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { runtimeError, success, type CliResult } from "../../cliResults.js";
import type { ChangeSubmitResult } from "../../change/submitChange.js";
import type { CandidateValidationFinding } from "../../change/candidateValidation/candidateValidationRunStore.js";
import type { ChangeStartResult } from "../../change/changeUseCases.js";

const changeFindingView = ({ severity: _severity, ...finding }: CandidateValidationFinding) =>
  finding;

type SubmitRecoveryAction =
  | "prepare_change"
  | "resolve_dirty_work"
  | "fix_validation_findings"
  | "integrate_change_base";
import { structuredContractDiagnostics } from "../../output/contractDiagnostics.js";

export const submitRecovery = (
  changeId: string,
  action: SubmitRecoveryAction,
  instruction: string,
): {
  readonly authority: "change_submit";
  readonly changeId: string;
  readonly action: SubmitRecoveryAction;
  readonly instruction: string;
  readonly retryCommand: string;
} => ({
  authority: "change_submit",
  changeId,
  action,
  instruction,
  retryCommand: `by change submit ${changeId}`,
});

export const submitResult = (result: ChangeSubmitResult, changeId: string): CliResult => {
  if (result.ok) {
    if (result.status === "nothing_to_submit") {
      return success({
        changeId: result.changeId,
        status: result.status,
        help: [`Run \`by change cancel ${result.changeId}\` to cancel this unchanged Change.`],
      });
    }
    if (result.status === "reconciled")
      return success({ status: result.status, change: result.change });
    if (result.status === "no_change")
      return success({
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        status: result.status,
        completionKind: result.completionKind,
        ...(result.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: result.reviewerEvidence }),
        ...(result.specialistReviewerEvidence === undefined
          ? {}
          : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
      });
    return success({
      changeId: result.changeId,
      candidateId: result.candidateId,
      validationRunId: result.validationRunId,
      status: result.status,
      created: result.created,
      pullRequest: result.pullRequest,
      ...(result.reviewerEvidence === undefined
        ? {}
        : { reviewerEvidence: result.reviewerEvidence }),
      ...(result.specialistReviewerEvidence === undefined
        ? {}
        : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
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
      details: { changeId: result.changeId, validationRunId: result.validationRunId },
      help: [
        `After stopping every process from the run, execute \`by validation-run abandon ${result.validationRunId} --reason <reason>\`.`,
      ],
    });
  }
  if (
    result.code === "change_not_found" ||
    result.code === "change_not_open" ||
    result.code === "change_blocked"
  ) {
    return runtimeError({
      code: result.code,
      message:
        result.code === "change_not_found"
          ? "Change was not found."
          : result.code === "change_blocked"
            ? "Change is blocked by an active Implementation Blocker."
            : "Change is closed.",
      ...(result.code === "change_blocked"
        ? {
            details: {
              changeId,
              blockerCommand: `by change blocker list ${changeId}`,
            },
          }
        : {}),
      help:
        result.code === "change_blocked"
          ? [
              `Inspect the existing Implementation Blocker with \`by change blocker list ${changeId}\`, then report it and wait.`,
            ]
          : ["Use a Change ID returned by `by change start --json`."],
    });
  }
  if (result.code === "change_not_ready") {
    return runtimeError({
      code: result.code,
      message: "Change is not ready for Submission.",
      details: {
        changeId: result.change.id,
        readiness: result.change.readiness,
        recovery: submitRecovery(
          result.change.id,
          "prepare_change",
          `Run \`by change prepare ${result.change.id}\`, then retry Change Submit.`,
        ),
      },
      help: [`Run \`by change prepare ${result.change.id}\`, then retry Change Submit.`],
    });
  }
  if (result.code === "dirty_work") {
    return runtimeError({
      code: result.code,
      message: "The Change Managed Worktree has uncommitted Git-visible state.",
      details: {
        changeId,
        recovery: submitRecovery(
          changeId,
          "resolve_dirty_work",
          "Commit or remove the Git-visible changes, then retry Change Submit.",
        ),
      },
      help: ["Commit or remove the visible changes, then retry Change Submit."],
    });
  }
  if (result.code === "validation_findings") {
    return runtimeError({
      code: result.code,
      message: "Validation produced blocking Findings.",
      details: {
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        findings: result.findings.map(changeFindingView),
        ...(result.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: result.reviewerEvidence }),
        ...(result.specialistReviewerEvidence === undefined
          ? {}
          : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
        recovery: submitRecovery(
          result.changeId,
          "fix_validation_findings",
          "Fix every applicable Finding in the Managed Worktree, commit the fixes, then retry Change Submit.",
        ),
      },
      help: ["Fix the Findings in the Managed Worktree, commit them, then retry Change Submit."],
    });
  }
  if (result.code === "validation_tooling_failed") {
    return runtimeError({
      code: result.code,
      message: "Candidate validation tooling failed.",
      details: {
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        toolingFailures: result.toolingFailures,
        ...(result.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: result.reviewerEvidence }),
        ...(result.specialistReviewerEvidence === undefined
          ? {}
          : { specialistReviewerEvidence: result.specialistReviewerEvidence }),
      },
      help: ["Fix the validation tooling failure, then retry Change Submit."],
    });
  }
  if (result.code === "change_base_not_ancestor") {
    return runtimeError({
      code: result.code,
      message: "The Repository Branch does not contain the freshly fetched Change Base.",
      details: {
        changeId,
        branchRef: result.branchRef,
        headSha: result.headSha,
        changeBaseRef: result.changeBaseRef,
        changeBaseSha: result.changeBaseSha,
        recovery: submitRecovery(
          changeId,
          "integrate_change_base",
          "Merge or rebase the Change Base into the Repository Branch, then retry Change Submit.",
        ),
      },
      help: [
        "Merge or rebase the Change Base into the Repository Branch, then retry Change Submit.",
      ],
    });
  }
  if (result.code === "validation_policy_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      ...(result.details === undefined
        ? {}
        : {
            details: {
              ...(result.details.path === undefined ? {} : { path: result.details.path }),
              ...(result.details.diagnostics === undefined
                ? {}
                : { diagnostics: structuredContractDiagnostics(result.details.diagnostics) }),
            },
          }),
      help: ["Fix Repo Config or Global Config, then retry Change Submit."],
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
    return remoteChangeBaseError(result, "Submit");
  }
  return runtimeError({
    code: result.code,
    message: "Change Submit could not validate or publish the current Candidate.",
    ...(result.code === "reconciliation_rejected" ? { details: { change: result.change } } : {}),
    help: ["Inspect the Change, validation evidence, and owned pull request, then retry."],
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
