// fallow-ignore-file unused-export -- dynamically imported by the CLI

import type { ChangeSubmitResult } from "../../change/submitChange.js";
import { type CliResult, runtimeError, success } from "../../cliResults.js";

type SubmitRecoveryAction =
  | "resolve_dirty_work"
  | "fix_validation_findings"
  | "integrate_change_base";

type SubmitSuccessResult = Extract<ChangeSubmitResult, { readonly ok: true }>;
type SubmitFailureResult = Extract<ChangeSubmitResult, { readonly ok: false }>;

import { structuredValue } from "../../output/structuredValue.js";
import { remoteChangeBaseError } from "./sharedResults.js";

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

export const submitResult = (result: ChangeSubmitResult, changeId: string): CliResult =>
  result.ok ? renderSuccessResult(result) : renderFailureResult(result, changeId);

const renderSuccessResult = (result: SubmitSuccessResult): CliResult => {
  if (result.status === "nothing_to_submit") {
    return success({
      changeId: result.changeId,
      status: result.status,
      help: [
        "Continue implementation in the Managed Worktree and retry Change Submit, or cancel explicitly.",
        `Run \`by change cancel ${result.changeId} --reason "<reason>"\` to cancel this unchanged Change.`,
      ],
    });
  }
  if (result.status === "completed") {
    return success({ status: result.status, change: structuredValue(result.change) });
  }
  if (result.status === "published") {
    return success({
      changeId: result.changeId,
      candidateId: result.candidateId,
      validationRunId: result.validationRunId,
      status: result.status,
      created: result.created,
      pullRequest: result.pullRequest,
    });
  }
  const exhaustiveResult: never = result;
  return exhaustiveResult;
};

const renderFailureResult = (result: SubmitFailureResult, changeId: string): CliResult =>
  renderSubmissionStateFailure(result) ??
  renderChangeStateFailure(result, changeId) ??
  renderCandidateCaptureFailure(result, changeId) ??
  renderValidationFailure(result) ??
  renderPublicationFailure(result, changeId) ??
  renderRemoteBaseFailure(result) ??
  renderReconciliationFailure(result) ??
  genericFailure(result);

const renderSubmissionStateFailure = (result: SubmitFailureResult): CliResult | undefined => {
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
  return undefined;
};

const renderChangeStateFailure = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
  if (
    result.code !== "change_not_found" &&
    result.code !== "change_not_open" &&
    result.code !== "change_blocked"
  ) {
    return undefined;
  }
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
        : ["Use a Change ID returned by `by change start`."],
  });
};

const renderValidationFailure = (result: SubmitFailureResult): CliResult | undefined => {
  if (result.code === "validation_findings") {
    return runtimeError({
      code: result.code,
      message: "Validation produced blocking Findings.",
      details: {
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        findings: result.findings,
        ...(result.stallDetectionUnavailable === undefined
          ? {}
          : { stallDetectionUnavailable: result.stallDetectionUnavailable }),
        recovery: submitRecovery(
          result.changeId,
          "fix_validation_findings",
          "Fix every applicable Finding in the Managed Worktree, commit the fixes, then retry Change Submit.",
        ),
      },
      help: ["Fix the Findings in the Managed Worktree, commit them, then retry Change Submit."],
    });
  }
  if (result.code === "stall_detection_blocker_failed") {
    return runtimeError({
      code: result.code,
      message: "Stall Detection could not persist its Implementation Blocker.",
      details: {
        changeId: result.changeId,
        candidateId: result.candidateId,
        validationRunId: result.validationRunId,
        validationRunIds: result.validationRunIds,
        change: structuredValue(result.change),
      },
      help: [
        `Restore access to valid repository state, inspect the blocker with \`by change blocker list ${result.changeId}\`, then retry \`by change submit ${result.changeId}\`.`,
      ],
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
      },
      help: ["Fix the validation tooling failure, then retry Change Submit."],
    });
  }
  if (result.code === "validation_policy_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      help: [
        "Restore any external resource required by the frozen Change Policy, then retry Change Submit.",
        "If the frozen Change Policy is permanently unusable, cancel the Change and start a new one.",
      ],
    });
  }
  return undefined;
};

const renderCandidateCaptureFailure = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
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
  return undefined;
};

const renderPublicationFailure = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined =>
  renderCurrentHeadMismatch(result, changeId) ??
  renderPublicationRemoteMismatch(result, changeId) ??
  renderUncertainPublicationFailure(result, changeId) ??
  renderPushDestinationFailure(result, changeId) ??
  renderUpstreamAssociationFailure(result, changeId) ??
  renderPublicationConfirmationFailure(result, changeId) ??
  renderOwnedPullRequestFailure(result);

const renderCurrentHeadMismatch = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
  if (result.code !== "current_head_mismatch") return undefined;
  return runtimeError({
    code: result.code,
    message: "The Managed Worktree branch no longer matches the expected Candidate.",
    details: {
      changeId,
      ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
    },
    help: ["Restore the expected Candidate head, then retry Submit."],
  });
};

const renderPublicationRemoteMismatch = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
  if (result.code !== "publication_remote_mismatch") return undefined;
  return runtimeError({
    code: result.code,
    message: "The Remote Change Branch or pull request does not match the expected Candidate.",
    details: {
      changeId,
      ...(result.expectedRemoteHeadSha === undefined
        ? {}
        : { expectedCommit: result.expectedRemoteHeadSha }),
      ...(result.observedRemoteHeadSha === undefined
        ? {}
        : { observedCommit: result.observedRemoteHeadSha }),
      ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
      ...(result.recoveryEvidence === undefined
        ? {}
        : { recoveryEvidence: result.recoveryEvidence }),
    },
    help: ["Inspect and resolve the remote commit or pull request, then retry Submit."],
  });
};

const renderUncertainPublicationFailure = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
  if (
    result.code !== "publication_tooling_failed" ||
    result.recoveryEvidence?.remoteBranchState === undefined
  ) {
    return undefined;
  }
  const message =
    result.recoveryEvidence.remoteBranchState === "retryable_absence"
      ? "The uncertain initial push was observed with an absent Remote Change Branch."
      : result.recoveryEvidence.remoteBranchState === "retained_prior_head"
        ? "The uncertain revised push retained the previously confirmed Remote Change Branch head."
        : "The Remote Change Branch could not be confirmed after an uncertain push.";
  return runtimeError({
    code: result.code,
    message,
    details: {
      changeId,
      ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
      recoveryEvidence: result.recoveryEvidence,
      ...(result.expectedRemoteHeadSha === undefined
        ? {}
        : { expectedCommit: result.expectedRemoteHeadSha }),
      ...(result.observedRemoteHeadSha === undefined
        ? {}
        : { observedCommit: result.observedRemoteHeadSha }),
    },
    help: ["Retry Change Submit after confirming the publication remote is available."],
  });
};

const renderPushDestinationFailure = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
  if (
    result.code !== "publication_tooling_failed" ||
    result.evidence?.operation !== "push_destination"
  ) {
    return undefined;
  }
  return runtimeError({
    code: result.code,
    message:
      "Exactly one safe push destination could not be validated for the selected publication remote.",
    details: { changeId, evidence: result.evidence },
    help: [
      "Correct the selected publication remote's effective push destination, then retry Submit.",
    ],
  });
};

const renderUpstreamAssociationFailure = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
  if (result.code !== "repository_branch_upstream_association_failed") return undefined;
  return runtimeError({
    code: result.code,
    message: "Candidate Publication was confirmed, but standard Git upstream association failed.",
    details: { changeId },
    help: ["Inspect the local Repository Branch config, then retry Change Submit."],
  });
};

const renderPublicationConfirmationFailure = (
  result: SubmitFailureResult,
  changeId: string,
): CliResult | undefined => {
  if (
    result.code !== "publication_creation_unconfirmed" &&
    result.code !== "publication_lookup_ambiguous" &&
    result.code !== "publication_tooling_failed"
  ) {
    return undefined;
  }
  return runtimeError({
    code: result.code,
    message: "Candidate Publication could not be confirmed safely.",
    details: {
      changeId,
      ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
      ...(result.recoveryEvidence === undefined
        ? {}
        : { recoveryEvidence: result.recoveryEvidence }),
    },
    help: ["Inspect the pending publication and retry Submit."],
  });
};

const renderOwnedPullRequestFailure = (result: SubmitFailureResult): CliResult | undefined => {
  if (result.code !== "owned_pull_request_unavailable") return undefined;
  return runtimeError({
    code: result.code,
    message: "The owned pull request facts are temporarily unavailable.",
    details: { changeId: result.changeId, reason: result.reason },
    help: ["Restore GitHub access and the owned pull request, then retry Submit."],
  });
};

const renderRemoteBaseFailure = (result: SubmitFailureResult): CliResult | undefined => {
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
  return undefined;
};

const renderReconciliationFailure = (result: SubmitFailureResult): CliResult | undefined => {
  if (result.code !== "reconciliation_rejected") return undefined;
  return runtimeError({
    code: result.code,
    message: "Change Submit could not validate or publish the current Candidate.",
    details: { change: result.change },
    help: ["Inspect the Change, validation evidence, and owned pull request, then retry."],
  });
};

const genericFailure = (result: SubmitFailureResult): CliResult =>
  runtimeError({
    code: result.code,
    message: "Change Submit could not validate or publish the current Candidate.",
    help: ["Inspect the Change, validation evidence, and owned pull request, then retry."],
  });
