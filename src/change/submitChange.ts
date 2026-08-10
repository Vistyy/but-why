import { Effect } from "effect";
import type { GlobalConfigValidationFailed } from "../contracts/configErrors.js";
import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import type { ExecutionLock } from "../contracts/executionLock.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type {
  RemoteChangeBaseError,
  RemoteChangeBaseResult,
} from "../submissionEnvironment/remoteChangeBase.js";
import type { RepositoryBranchHeadResult } from "./candidateCapture/candidateCaptureGit.js";
import type {
  CaptureLocalCandidateInput,
  CaptureLocalCandidateResult,
} from "./candidateCapture/captureLocalCandidate.js";
import type {
  CandidateValidationFinding,
  CandidateValidationToolingFailure,
} from "./candidateValidation/candidateValidationRunStore.js";
import type {
  CandidateValidationPolicyResolution,
  ResolvedCandidateValidationPolicy,
} from "./candidateValidation/resolveCandidateValidationPolicy.js";
import {
  CandidateValidation,
  type CandidateValidationService,
} from "./candidateValidation/validateCandidate.js";
import { type ChangePublicationTarget, type ChangeRecord, changeState } from "./change.js";
import type { ChangeSubmissionPort } from "./changePorts.js";
import {
  type OwnedPullRequestUnavailableReason,
  observedMergedChangeEvidence,
  observeOwnedPullRequest,
} from "./ownedPullRequestClassifier.js";
import type { GitHubPullRequestGateway } from "./ownedPullRequestGateway.js";
import type {
  CandidatePublication,
  PublishCandidateResult,
} from "./publication/candidatePublication.js";
import type { ReconciledChange } from "./reconcileChange.js";
import type { SpecialistReviewerContinuityEvidence } from "./specialistReview/runSpecialistReviewPhase.js";
import type { SubmitRejectionError } from "./submit/submitRejectionErrors.js";
import type { SubmitProgress } from "./validation/submitProgress.js";
import type { ReviewerExecutionEvidence } from "./validationRun/reviewerArtifacts.js";

export type ChangeSubmitResult =
  | {
      readonly ok: true;
      readonly status: "nothing_to_submit";
      readonly changeId: string;
    }
  | {
      readonly ok: true;
      readonly status: "published";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly created: boolean;
      readonly pullRequest: { readonly number: number; readonly url: string };
      readonly reviewerEvidence?: ReviewerExecutionEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: true;
      readonly status: "completed";
      readonly change: ChangeRecord;
    }
  | {
      readonly ok: false;
      readonly code: "validation_findings";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly findings: readonly CandidateValidationFinding[];
      readonly reviewerEvidence?: ReviewerExecutionEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: false;
      readonly code: "validation_tooling_failed";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly toolingFailures: readonly CandidateValidationToolingFailure[];
      readonly reviewerEvidence?: ReviewerExecutionEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: false;
      readonly code: "submission_in_progress" | "active_validation_run";
      readonly changeId: string;
      readonly validationRunId: string | null;
    }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_open" | "change_blocked" }
  | {
      readonly ok: false;
      readonly code: "reconciliation_rejected";
      readonly change: ReconciledChange;
    }
  | {
      readonly ok: false;
      readonly code: "owned_pull_request_unavailable";
      readonly changeId: string;
      readonly reason: OwnedPullRequestUnavailableReason;
    }
  | {
      readonly ok: false;
      readonly code: "validation_policy_invalid";
      readonly message: string;
      readonly details?:
        | {
            readonly path?: string;
            readonly diagnostics?: readonly ContractDiagnostic[];
          }
        | undefined;
    }
  | { readonly ok: false; readonly code: "github_target_not_found" | "github_tooling_error" }
  | RemoteChangeBaseError
  | {
      readonly ok: false;
      readonly code: PublishCandidateFailureCode;
      readonly evidence?: import("./ownedPullRequestGateway.js").PublicationFailureEvidence;
      readonly recoveryEvidence?: import("./ownedPullRequestGateway.js").PublicationFailureEvidence;
      readonly expectedRemoteHeadSha?: string;
      readonly observedRemoteHeadSha?: string;
    }
  | Exclude<CaptureLocalCandidateResult, { readonly ok: true }>;

type PublishCandidateFailureCode = Exclude<PublishCandidateResult, { readonly ok: true }>["code"];
type CapturedCandidate = Extract<CaptureLocalCandidateResult, { readonly ok: true }>;

export type PublicationTargetDetectionResult =
  | {
      readonly ok: true;
      readonly target: ChangePublicationTarget & { readonly remoteUrl: string };
    }
  | {
      readonly ok: false;
      readonly code: "PR_TARGET_NOT_FOUND" | "GITHUB_TOOLING_ERROR";
    };

export type ManagedRepoConfigResolution =
  | { readonly ok: true; readonly config: RepoConfig }
  | {
      readonly ok: false;
      readonly message: string;
      readonly path?: string;
      readonly diagnostics?: readonly ContractDiagnostic[];
    };

export type ChangeSubmitInput = {
  readonly changeId: string;
  readonly now: string;
  readonly progress?: SubmitProgress;
};

export type ChangeSubmit = {
  readonly submit: (
    input: ChangeSubmitInput,
  ) => Effect.Effect<ChangeSubmitResult, RepositoryStorageError>;
};

export type CandidateValidationChangeSubmit = {
  readonly submit: (
    input: ChangeSubmitInput,
  ) => Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation>;
};

type CaptureCandidate = (
  input: CaptureLocalCandidateInput,
) => Effect.Effect<CaptureLocalCandidateResult, RepositoryStorageError>;

export const openChangeSubmit = (dependencies: {
  readonly repositoryCommonDirectory: string;
  readonly repositoryPath: string;
  readonly persistence: ChangeSubmissionPort;
  readonly github: GitHubPullRequestGateway;
  readonly loadRepoConfig: (worktreePath: string) => ManagedRepoConfigResolution;
  readonly loadRepoConfigAtCommit: (
    worktreePath: string,
    commit: string,
  ) => ManagedRepoConfigResolution;
  readonly resolvePolicy: (
    acceptanceContextSupplied: boolean,
    repoConfig: RepoConfig,
    worktreePath: string,
    validationRepoConfig?: RepoConfig,
  ) => CandidateValidationPolicyResolution;
  readonly publicationFor: (cwd: string) => CandidatePublication;
  readonly refreshBase: (
    cwd: string,
    baseRef: string,
    expectedRemoteUrl: string,
  ) => RemoteChangeBaseResult;
  readonly readBranchHead: (
    cwd: string,
    expectedBranchRef: string,
  ) => Effect.Effect<RepositoryBranchHeadResult>;
  readonly detectTarget: (
    cwd: string,
    branch: string,
    baseRef: string,
    baseRemoteUrl: string,
  ) => PublicationTargetDetectionResult;
  readonly captureCandidate: CaptureCandidate;
  readonly executionLock: ExecutionLock;
}): CandidateValidationChangeSubmit => ({
  submit: (input) =>
    dependencies.executionLock
      .withLock({
        owner: "change_submission",
        key: input.changeId,
        effect: submitChange(dependencies, input),
      })
      .pipe(
        Effect.catchTag("ExecutionLockUnavailable", () =>
          Effect.succeed({
            ok: false,
            code: "submission_in_progress",
            changeId: input.changeId,
            validationRunId: null,
          } as const),
        ),
      ),
});

type OpenChangeWithWorktree = ChangeRecord & { readonly worktreePath: string };
type SubmissionDecision =
  | { readonly proceed: true; readonly ownedPullRequestOpen: boolean }
  | { readonly proceed: false; readonly result: ChangeSubmitResult };

const submitChange = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  input: ChangeSubmitInput,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    const selected = yield* selectOpenChange(dependencies.persistence, input.changeId);
    if (!selected.ok) return selected;
    const change = selected.change;
    if (change.baseRef === null || change.baseRemoteUrl === null) {
      return { ok: false, code: "invalid_remote_change_base", baseRef: "" } as const;
    }
    const decision = yield* observeBeforeSubmission(dependencies, change, input.now);
    if (!decision.proceed) return decision.result;
    const completedPublication = yield* completedPublicationEvidence(
      dependencies,
      change,
      decision.ownedPullRequestOpen,
    );
    if (completedPublication.ok) return completedPublication.result;
    const refreshedBase = dependencies.refreshBase(
      dependencies.repositoryPath,
      change.baseRef,
      change.baseRemoteUrl,
    );
    if (!refreshedBase.ok) return refreshedBase;
    const candidate = yield* dependencies.captureCandidate({
      cwd: change.worktreePath,
      changeId: change.id,
      now: input.now,
      changeBaseSha: refreshedBase.base.commit,
    });
    if (!candidate.ok) return candidate;
    if (candidate.trackedTreeMatchesChangeBase) {
      return { ok: true, status: "nothing_to_submit", changeId: change.id } as const;
    }
    const baselineRepoConfig = dependencies.loadRepoConfigAtCommit(
      change.worktreePath,
      refreshedBase.base.commit,
    );
    if (!baselineRepoConfig.ok) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: baselineRepoConfig.message,
        ...(configFailureDetails(baselineRepoConfig) === undefined
          ? {}
          : { details: configFailureDetails(baselineRepoConfig) }),
      } as const;
    }
    const candidateRepoConfig = dependencies.loadRepoConfig(change.worktreePath);
    if (!candidateRepoConfig.ok) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: candidateRepoConfig.message,
        ...(configFailureDetails(candidateRepoConfig) === undefined
          ? {}
          : { details: configFailureDetails(candidateRepoConfig) }),
      } as const;
    }
    const policy = dependencies.resolvePolicy(
      change.acceptanceContext !== null,
      candidateRepoConfig.config,
      change.worktreePath,
      baselineRepoConfig.config,
    );
    if (!policy.ok) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        ...formatValidationPolicyFailure(policy.error),
      } as const;
    }
    const target = detectPublicationTarget(dependencies, change, candidate);
    if (!target.ok) return githubTargetFailure(target);
    return yield* validateAndPublish(
      dependencies,
      change,
      candidate,
      policy.resolved,
      target.target,
      input.now,
      input.progress,
    );
  });

const configFailureDetails = (failure: {
  readonly path?: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
}):
  | { readonly path?: string; readonly diagnostics?: readonly ContractDiagnostic[] }
  | undefined => {
  if (failure.path === undefined && failure.diagnostics === undefined) return undefined;
  return {
    ...(failure.path === undefined ? {} : { path: failure.path }),
    ...(failure.diagnostics === undefined ? {} : { diagnostics: failure.diagnostics }),
  };
};

type ValidationPolicyFailure =
  | { readonly message: string }
  | {
      readonly message: string;
      readonly details: NonNullable<ReturnType<typeof configFailureDetails>>;
    };

const formatValidationPolicyFailure = (
  error: SubmitRejectionError | GlobalConfigValidationFailed,
): ValidationPolicyFailure => {
  switch (error._tag) {
    case "MissingAgentProfile":
      return error.profileName === undefined
        ? { message: "Global Config needs a default Agent Profile for reviewer selection." }
        : {
            message: `Agent Profile "${error.profileName}" in ${error.scope ?? "unknown"} scope was not found.`,
          };
    case "MissingAgentModel":
      return {
        message: `Agent Profile "${error.profileName}" in ${error.scope ?? "unknown"} scope has no Pi model in runtimeConfig.`,
      };
    case "RepoConfigValidationFailed":
    case "GlobalConfigValidationFailed":
      return { message: error.message, details: configFailureDetails(error) ?? {} };
    default:
      return { message: error.message };
  }
};

const observeBeforeSubmission = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: OpenChangeWithWorktree,
  now: string,
): Effect.Effect<SubmissionDecision, RepositoryStorageError> =>
  Effect.gen(function* () {
    const classification = observeOwnedPullRequest(dependencies.github, change);
    switch (classification.kind) {
      case "not_owned":
      case "exact_open":
      case "exact_closed_unmerged":
        return {
          proceed: true,
          ownedPullRequestOpen: classification.kind === "exact_open",
        };
      case "exact_merged": {
        const observed = observedMergedChangeEvidence(change, classification.pullRequest);
        if (observed === undefined) {
          return {
            proceed: false,
            result: {
              ok: false,
              code: "reconciliation_rejected",
              change: {
                changeId: change.id,
                status: "rejected",
                rejection: "missing_publication_facts",
              },
            } as const,
          };
        }
        const completed = yield* dependencies.persistence.completeMergedChange({
          changeId: change.id,
          now,
          observed,
        });
        if (!completed.ok) {
          return {
            proceed: false,
            result: {
              ok: false,
              code: "reconciliation_rejected",
              change: {
                changeId: change.id,
                status: "rejected",
                rejection: completed.code,
              },
            } as const,
          };
        }
        return {
          proceed: false,
          result: { ok: true, status: "completed", change: completed.change } as const,
        };
      }
      case "mismatch":
        return {
          proceed: false,
          result: {
            ok: false,
            code: "reconciliation_rejected",
            change: {
              changeId: change.id,
              status: "rejected",
              rejection: classification.rejection,
            },
          } as const,
        };
      case "unavailable":
        return {
          proceed: false,
          result: {
            ok: false,
            code: "owned_pull_request_unavailable",
            changeId: change.id,
            reason: classification.reason,
          } as const,
        };
    }
  });

const publicationPolicySnapshot = (
  change: ChangeRecord,
  policy: ResolvedCandidateValidationPolicy,
) => ({
  ...policy.policy,
  ...(change.acceptanceContext === null ? {} : { acceptanceContext: change.acceptanceContext }),
});

const completedPublicationEvidence = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: OpenChangeWithWorktree,
  ownedPullRequestOpen: boolean,
): Effect.Effect<
  { readonly ok: true; readonly result: ChangeSubmitResult } | { readonly ok: false },
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    if (change.publication === null || change.publication.pullRequest === null)
      return { ok: false };
    if (!ownedPullRequestOpen) return { ok: false };
    const branchHead = yield* dependencies.readBranchHead(change.worktreePath, change.branchRef);
    if (!branchHead.ok) return { ok: false };
    if (branchHead.headSha !== change.publication.expectedHeadSha) return { ok: false };
    const evidence = yield* dependencies.persistence.getCompletedPublicationEvidence(
      change.id,
      change.publication.candidateId,
      change.publication.validationRunId,
    );
    if (
      evidence === undefined ||
      evidence.candidateId !== change.publication.candidateId ||
      evidence.validationRunId !== change.publication.validationRunId ||
      evidence.headSha !== branchHead.headSha
    ) {
      return { ok: false };
    }
    return { ok: true, result: publishedResult(change, false) };
  });

const validateAndPublish = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: OpenChangeWithWorktree,
  candidate: CapturedCandidate,
  policy: ResolvedCandidateValidationPolicy,
  target: ChangePublicationTarget,
  now: string,
  progress: SubmitProgress | undefined,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    const validation = yield* CandidateValidation;
    const validationResult =
      policy.acceptanceContextSupplied && change.acceptanceContext !== null
        ? yield* validation.validateAcceptanceContextCandidate({
            changeId: change.id,
            ...candidateIdentity(candidate),
            resourceRoot: change.worktreePath,
            policy: policy.policy,
            ...(progress === undefined ? {} : { progress }),
            now,
          })
        : yield* validation.validateCandidate({
            changeId: change.id,
            ...candidateIdentity(candidate),
            resourceRoot: change.worktreePath,
            policy: policy.policy,
            ...(progress === undefined ? {} : { progress }),
            now,
          });
    if ("code" in validationResult) {
      if (validationResult.code === "blocked") {
        return { ok: false, code: "change_blocked" } as const;
      }
      return {
        ok: false,
        code: "active_validation_run",
        changeId: change.id,
        validationRunId: validationResult.validationRunId,
      } as const;
    }
    if (validationResult.outcome !== "passed") {
      return yield* blockedValidationResult(validation, change, candidate, {
        validationRunId: validationResult.validationRunId,
        outcome: validationResult.outcome === "blocked" ? "blocked" : "tooling_failed",
        ...(validationResult.reviewerEvidence === undefined
          ? {}
          : { reviewerEvidence: validationResult.reviewerEvidence }),
        ...(validationResult.specialistReviewerEvidence === undefined
          ? {}
          : { specialistReviewerEvidence: validationResult.specialistReviewerEvidence }),
      });
    }

    const publication = yield* dependencies.publicationFor(change.worktreePath).publish({
      changeId: change.id,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      changeBaseSha: candidate.changeBaseSha,
      policy: publicationPolicySnapshot(change, policy),
      target,
      now,
    });
    if (!publication.ok) {
      return publication;
    }
    return {
      ok: true,
      status: "published",
      changeId: change.id,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      created: publication.created,
      pullRequest: publication.pullRequest,
      ...(validationResult.reviewerEvidence === undefined
        ? {}
        : { reviewerEvidence: validationResult.reviewerEvidence }),
      ...(validationResult.specialistReviewerEvidence === undefined
        ? {}
        : { specialistReviewerEvidence: validationResult.specialistReviewerEvidence }),
    } as const;
  });

const blockedValidationResult = (
  candidateValidation: CandidateValidationService,
  change: OpenChangeWithWorktree,
  candidate: CapturedCandidate,
  validation: {
    readonly outcome: "blocked" | "tooling_failed";
    readonly validationRunId: string;
    readonly reviewerEvidence?: ReviewerExecutionEvidence;
    readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
  },
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    return validation.outcome === "blocked"
      ? {
          ok: false,
          code: "validation_findings",
          changeId: change.id,
          candidateId: candidate.candidateId,
          validationRunId: validation.validationRunId,
          findings: yield* candidateValidation.listFindings(validation.validationRunId),
          ...(validation.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: validation.reviewerEvidence }),
          ...(validation.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: validation.specialistReviewerEvidence }),
        }
      : {
          ok: false,
          code: "validation_tooling_failed",
          changeId: change.id,
          candidateId: candidate.candidateId,
          validationRunId: validation.validationRunId,
          toolingFailures: yield* candidateValidation.listToolingFailures(
            validation.validationRunId,
          ),
          ...(validation.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: validation.reviewerEvidence }),
          ...(validation.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: validation.specialistReviewerEvidence }),
        };
  });

const githubTargetFailure = (
  target: Exclude<PublicationTargetDetectionResult, { readonly ok: true }>,
): ChangeSubmitResult => ({
  ok: false,
  code: target.code === "PR_TARGET_NOT_FOUND" ? "github_target_not_found" : "github_tooling_error",
});

const selectOpenChange = (
  persistence: ChangeSubmissionPort,
  changeId: string,
): Effect.Effect<
  | { readonly ok: true; readonly change: ChangeRecord & { readonly worktreePath: string } }
  | Extract<
      ChangeSubmitResult,
      {
        readonly code: "change_not_found" | "change_not_open" | "change_blocked";
      }
    >,
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    const change = yield* persistence.getChangeById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    if (change.worktreePath === null) {
      return { ok: false, code: "change_not_open" };
    }
    return { ok: true, change: change as ChangeRecord & { readonly worktreePath: string } };
  });

const candidateIdentity = (candidate: CapturedCandidate) => ({
  candidateId: candidate.candidateId,
  changeBaseSha: candidate.changeBaseSha,
  headSha: candidate.headSha,
});

const detectPublicationTarget = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ChangeRecord & { readonly worktreePath: string },
  candidate: CapturedCandidate,
): PublicationTargetDetectionResult =>
  dependencies.detectTarget(
    change.worktreePath,
    candidate.branchRef.replace(/^refs\/heads\//, ""),
    change.baseRef ?? "",
    change.baseRemoteUrl ?? "",
  );

const publishedResult = (change: ChangeRecord, created: boolean): ChangeSubmitResult => {
  const publication = change.publication;
  if (publication?.pullRequest === null || publication === null) {
    throw new Error("Reconciled Change lacks owned pull request facts");
  }
  return {
    ok: true,
    status: "published",
    changeId: change.id,
    candidateId: publication.candidateId,
    validationRunId: publication.validationRunId,
    created,
    pullRequest: publication.pullRequest,
  };
};
