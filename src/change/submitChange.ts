import { Effect } from "effect";
import type { ExecutionLock } from "../contracts/executionLock.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { SubmitProgress } from "../submission/submissionProgress.js";
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
import {
  CandidateValidation,
  type CandidateValidationService,
} from "./candidateValidation/validateCandidate.js";
import { type ChangePublicationTarget, type ChangeRecord, changeState } from "./change.js";
import type { ChangeSubmissionPort, SubmissionChange } from "./changePorts.js";
import { validateChangeReviewerConfigurationResources } from "./changeReviewerConfiguration.js";
import {
  type OwnedPublication,
  type OwnedPullRequestUnavailableReason,
  observedMergedChangeEvidence,
  observeOwnedPullRequest,
} from "./ownedPullRequestClassifier.js";
import type {
  GitHubPullRequestReader,
  PublicationFailureEvidence,
} from "./ownedPullRequestGateway.js";
import type {
  CandidatePublication,
  PublishCandidateResult,
} from "./publication/candidatePublication.js";
import type { ReconciledChange } from "./reconcileChange.js";
import type { StallDetectionService } from "./runStallDetection.js";

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
      readonly candidateId: number;
      readonly validationRunId: number;
      readonly created: boolean;
      readonly pullRequest: { readonly number: number; readonly url: string };
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
      readonly candidateId: number;
      readonly validationRunId: number;
      readonly findings: readonly CandidateValidationFinding[];
      readonly stallDetection?: {
        readonly code: "stall_detection_unavailable";
        readonly message: string;
      };
    }
  | {
      readonly ok: false;
      readonly code: "validation_tooling_failed";
      readonly changeId: string;
      readonly candidateId: number;
      readonly validationRunId: number;
      readonly toolingFailures: readonly CandidateValidationToolingFailure[];
    }
  | {
      readonly ok: false;
      readonly code: "submission_in_progress" | "active_validation_run";
      readonly changeId: string;
      readonly validationRunId: number | null;
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
    }
  | { readonly ok: false; readonly code: "github_target_not_found" | "github_tooling_error" }
  | RemoteChangeBaseError
  | {
      readonly ok: false;
      readonly code: PublishCandidateFailureCode;
      readonly evidence?: PublicationFailureEvidence;
      readonly recoveryEvidence?: PublicationFailureEvidence;
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
  readonly repositoryPath: string;
  readonly persistence: ChangeSubmissionPort;
  readonly github: GitHubPullRequestReader;
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
  readonly stallDetection?: StallDetectionService;
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

type OpenChangeWithWorktree = SubmissionChange & {
  readonly worktreePath: string;
  readonly baseRef: string;
  readonly baseRemoteUrl: string;
};
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
    const decision = yield* observeBeforeSubmission(dependencies, change, input.now);
    if (!decision.proceed) return decision.result;
    const completedPublication = yield* completedPublicationEvidence(
      dependencies,
      change,
      decision.ownedPullRequestOpen,
    );
    if (completedPublication.ok) return completedPublication.result;
    if (completedPublication.result !== undefined) return completedPublication.result;
    const refreshedBase = dependencies.refreshBase(
      dependencies.repositoryPath,
      change.baseRef,
      change.baseRemoteUrl,
    );
    if (!refreshedBase.ok) return refreshedBase;
    const candidate = yield* dependencies.captureCandidate({
      cwd: change.worktreePath,
      changeId: change.id,
      changeBaseSha: refreshedBase.base.commit,
    });
    if (!candidate.ok) return candidate;
    if (candidate.trackedTreeMatchesChangeBase) {
      return { ok: true, status: "nothing_to_submit", changeId: change.id } as const;
    }
    if (
      change.acceptanceContext !== null &&
      change.policy.reviewerConfiguration.acceptanceReview === null
    ) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: "The Change policy has no Acceptance Reviewer for its Acceptance Context.",
      } as const;
    }
    const resources = validateChangeReviewerConfigurationResources(
      change.policy.reviewerConfiguration,
      dependencies.repositoryPath,
    );
    if (!resources.ok) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: resources.message,
      } as const;
    }
    const target = detectPublicationTarget(dependencies, change, candidate);
    if (!target.ok) return githubTargetFailure(target);
    return yield* validateAndPublish(
      dependencies,
      change,
      candidate,
      target.target,
      input.now,
      input.progress,
    );
  });

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
        const outputChange = yield* dependencies.persistence.getChangeForOutputById(change.id);
        if (outputChange === undefined) {
          return { proceed: false, result: { ok: false, code: "change_not_found" } as const };
        }
        return {
          proceed: false,
          result: { ok: true, status: "completed", change: outputChange } as const,
        };
      }
      case "mismatch":
        if (classification.rejection === "head_sha_mismatch") {
          return { proceed: true, ownedPullRequestOpen: false };
        }
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

const completedPublicationEvidence = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: OpenChangeWithWorktree,
  ownedPullRequestOpen: boolean,
): Effect.Effect<
  | { readonly ok: true; readonly result: ChangeSubmitResult }
  | { readonly ok: false; readonly result?: ChangeSubmitResult },
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    if (change.publication === null || change.publication.pullRequest === null)
      return { ok: false } as const;
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
      return { ok: false } as const;
    }
    const association = yield* dependencies
      .publicationFor(change.worktreePath)
      .associatePublishedChange(change.id);
    if (!association.ok) {
      return {
        ok: false,
        result: {
          ok: false,
          code: "repository_branch_upstream_association_failed",
        },
      } as const;
    }
    return {
      ok: true,
      result: publishedResult(
        change.id,
        {
          ...change.publication,
          pullRequest: change.publication.pullRequest,
        },
        false,
      ),
    };
  });

const validateAndPublish = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: OpenChangeWithWorktree,
  candidate: CapturedCandidate,
  target: ChangePublicationTarget,
  now: string,
  progress: SubmitProgress | undefined,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    const validation = yield* CandidateValidation;
    const validationResult =
      change.acceptanceContext !== null
        ? yield* validation.validateAcceptanceContextCandidate({
            ...candidateIdentity(candidate),
            ...(progress === undefined ? {} : { progress }),
          })
        : yield* validation.validateCandidate({
            ...candidateIdentity(candidate),
            ...(progress === undefined ? {} : { progress }),
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
      return yield* blockedValidationResult(dependencies, validation, change, candidate, {
        validationRunId: validationResult.validationRunId,
        outcome: validationResult.outcome === "blocked" ? "blocked" : "tooling_failed",
        now,
      });
    }

    const publication = yield* dependencies.publicationFor(change.worktreePath).publish({
      changeId: change.id,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      changeBaseSha: candidate.changeBaseSha,
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
    } as const;
  });

const blockedValidationResult = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  candidateValidation: CandidateValidationService,
  change: OpenChangeWithWorktree,
  candidate: CapturedCandidate,
  validation: {
    readonly outcome: "blocked" | "tooling_failed";
    readonly validationRunId: number;
    readonly now: string;
  },
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (
      validation.outcome === "blocked" &&
      change.acceptanceContext !== null &&
      change.policy.stallDetection?.enabled
    ) {
      const profile = change.policy.stallDetection.profile;
      if (profile === null) {
        return yield* Effect.dieMessage("Enabled Stall Detection has no Agent Profile");
      }
      if (dependencies.stallDetection !== undefined) {
        const detected = yield* dependencies.stallDetection.assess({
          changeId: change.id,
          validationRunId: validation.validationRunId,
          configuration: profile,
          now: validation.now,
        });
        if (detected.attempted && "record" in detected && detected.record.decision === "stop") {
          return { ok: false, code: "change_blocked" } as const;
        }
        const findings = yield* candidateValidation.listFindings(validation.validationRunId);
        return {
          ok: false,
          code: "validation_findings",
          changeId: change.id,
          candidateId: candidate.candidateId,
          validationRunId: validation.validationRunId,
          findings,
          ...(detected.attempted && "diagnostic" in detected
            ? { stallDetection: detected.diagnostic }
            : {}),
        } as const;
      }
    }
    return validation.outcome === "blocked"
      ? {
          ok: false,
          code: "validation_findings",
          changeId: change.id,
          candidateId: candidate.candidateId,
          validationRunId: validation.validationRunId,
          findings: yield* candidateValidation.listFindings(validation.validationRunId),
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
  | { readonly ok: true; readonly change: OpenChangeWithWorktree }
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
    if (change.activeBlocker !== null) return { ok: false, code: "change_blocked" };
    if (change.worktreePath === null || change.baseRef === null || change.baseRemoteUrl === null) {
      return { ok: false, code: "change_not_open" };
    }
    return {
      ok: true,
      change: {
        ...change,
        worktreePath: change.worktreePath,
        baseRef: change.baseRef,
        baseRemoteUrl: change.baseRemoteUrl,
      },
    };
  });

const candidateIdentity = (candidate: CapturedCandidate) => ({
  candidateId: candidate.candidateId,
  changeBaseSha: candidate.changeBaseSha,
  headSha: candidate.headSha,
});

const detectPublicationTarget = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: OpenChangeWithWorktree,
  candidate: CapturedCandidate,
): PublicationTargetDetectionResult =>
  dependencies.detectTarget(
    change.worktreePath,
    candidate.branchRef.replace(/^refs\/heads\//, ""),
    change.baseRef,
    change.baseRemoteUrl,
  );

const publishedResult = (
  changeId: string,
  publication: OwnedPublication,
  created: boolean,
): ChangeSubmitResult => ({
  ok: true,
  status: "published",
  changeId,
  candidateId: publication.candidateId,
  validationRunId: publication.validationRunId,
  created,
  pullRequest: publication.pullRequest,
});
