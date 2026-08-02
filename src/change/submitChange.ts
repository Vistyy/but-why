import { Effect } from "effect";

import type { RepoConfig } from "../contracts/repoConfig.js";
import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import type { GlobalConfigValidationFailed } from "../contracts/configErrors.js";
import type { SubmitRejectionError } from "./submit/submitRejectionErrors.js";
import type {
  CandidateValidationPolicyResolution,
  ResolvedCandidateValidationPolicy,
} from "./candidateValidation/resolveCandidateValidationPolicy.js";
import type { ReviewerContinuityEvidence } from "./acceptanceReview/runAcceptanceReviewPhase.js";
import type { SpecialistReviewerContinuityEvidence } from "./specialistReview/runSpecialistReviewPhase.js";
import type {
  CandidateValidationFinding,
  CandidateValidationToolingFailure,
} from "./candidateValidation/candidateValidationRunStore.js";
import {
  CandidateValidation,
  type CandidateValidationService,
} from "./candidateValidation/validateCandidate.js";
import type {
  CaptureLocalCandidateInput,
  CaptureLocalCandidateResult,
} from "./candidateCapture/captureLocalCandidate.js";
import type { RepositoryBranchHeadResult } from "./candidateCapture/candidateCaptureGit.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { ExecutionLock } from "../contracts/executionLock.js";
import type { ChangeValidationPersistence } from "./validation/changeValidationPersistence.js";
import type {
  CandidatePublication,
  PublishCandidateResult,
} from "./publication/candidatePublication.js";
import type { TaskState } from "../task/lifecycle.js";
import type { TaskPersistence } from "../task/taskPersistence.js";
import {
  changeReadiness,
  changeState,
  type ChangePublicationTarget,
  type ChangeRecord,
} from "./change.js";
import type { ChangeReconciliation, ReconciledChange } from "./reconcileChange.js";
import type { ChangePersistence } from "./changePersistence.js";
import type {
  RemoteChangeBaseError,
  RemoteChangeBaseResult,
} from "../submissionEnvironment/remoteChangeBase.js";
import type { SubmitProgress } from "./validation/submitProgress.js";

export type ChangeSubmitResult =
  | {
      readonly ok: true;
      readonly status: "nothing_to_submit";
      readonly changeId: string;
    }
  | {
      readonly ok: true;
      readonly status: "no_change";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly completionKind: "no_change";
      readonly reviewerEvidence?: ReviewerContinuityEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: true;
      readonly status: "published";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly created: boolean;
      readonly pullRequest: { readonly number: number; readonly url: string };
      readonly reviewerEvidence?: ReviewerContinuityEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: true;
      readonly status: "reconciled";
      readonly change: ReconciledChange;
    }
  | {
      readonly ok: false;
      readonly code: "validation_findings";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly findings: readonly CandidateValidationFinding[];
      readonly reviewerEvidence?: ReviewerContinuityEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: false;
      readonly code: "validation_tooling_failed";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly toolingFailures: readonly CandidateValidationToolingFailure[];
      readonly reviewerEvidence?: ReviewerContinuityEvidence;
      readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
    }
  | {
      readonly ok: false;
      readonly code: "submission_in_progress" | "active_validation_run";
      readonly changeId: string;
      readonly validationRunId: string | null;
    }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_open" | "change_blocked" }
  | { readonly ok: false; readonly code: "change_not_ready"; readonly change: ChangeRecord }
  | {
      readonly ok: false;
      readonly code: "reconciliation_rejected";
      readonly change: ReconciledChange;
    }
  | { readonly ok: false; readonly code: "owned_pull_request_closed"; readonly changeId: string }
  | { readonly ok: false; readonly code: "task_transition_failed"; readonly changeId: string }
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
  | { readonly ok: false; readonly code: PublishCandidateFailureCode }
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
  readonly persistence: ChangePersistence;
  readonly taskPersistence: Pick<TaskPersistence, "getTaskById" | "transitionTaskState">;
  readonly reconciliation: ChangeReconciliation;
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
  readonly validationPersistence?: Pick<ChangeValidationPersistence, "getActiveForChange">;
  readonly executionLock?: ExecutionLock;
}): CandidateValidationChangeSubmit => ({
  submit: (input) => {
    const operation = submitChange(dependencies, input);
    const locked =
      dependencies.executionLock === undefined
        ? operation
        : dependencies.executionLock.withLock({
            owner: "change_submission",
            key: input.changeId,
            effect: operation,
          });
    return locked.pipe(
      Effect.catchTag("ExecutionLockUnavailable", () =>
        Effect.succeed({
          ok: false,
          code: "submission_in_progress",
          changeId: input.changeId,
          validationRunId: null,
        } as const),
      ),
    );
  },
});

type ReadyChange = ChangeRecord & { readonly worktreePath: string };
type ReconciliationDecision =
  | { readonly proceed: true; readonly reconciled: ReconciledChange }
  | { readonly proceed: false; readonly result: ChangeSubmitResult };

const submitChange = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  input: ChangeSubmitInput,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    const existing = yield* dependencies.persistence.getChangeById(input.changeId);
    if (existing?.noChangeCompletion !== undefined && existing.noChangeCompletion !== null) {
      return {
        ok: true,
        status: "no_change",
        changeId: existing.id,
        candidateId: existing.noChangeCompletion.candidateId,
        validationRunId: existing.noChangeCompletion.validationRunId,
        completionKind: "no_change",
      } as const;
    }
    const selected = yield* selectReadyChange(dependencies.persistence, input.changeId);
    if (!selected.ok) return selected;
    const change = selected.change;
    if (change.baseRef === null || change.baseRemoteUrl === null) {
      return { ok: false, code: "invalid_remote_change_base", baseRef: "" } as const;
    }
    const reconciliation = yield* reconcileBeforeSubmission(dependencies, change, input.now);
    if (!reconciliation.proceed) return reconciliation.result;
    const active = yield* dependencies.validationPersistence?.getActiveForChange(change.id) ??
      Effect.succeed(undefined);
    if (active !== undefined) {
      return {
        ok: false,
        code: "active_validation_run",
        changeId: change.id,
        validationRunId: active.validationRunId,
      } as const;
    }
    if (change.publication !== null && reconciliation.reconciled.status === "open") {
      const branchHead = yield* dependencies.readBranchHead(change.worktreePath, change.branchRef);
      if (!branchHead.ok) return branchHead;
      if (branchHead.headSha === change.publication.expectedHeadSha) {
        const evidence = yield* dependencies.persistence.getPassingPublicationEvidence(change.id);
        if (
          evidence?.candidateId === change.publication.candidateId &&
          evidence.validationRunId === change.publication.validationRunId &&
          evidence.headSha === branchHead.headSha
        ) {
          if (
            change.taskId !== null &&
            !(yield* transitionTask(dependencies.persistence, change, "ready", input.now))
          ) {
            return taskTransitionFailure(change);
          }
          return publishedResult(change, false);
        }
      }
    }
    const refreshedBase = dependencies.refreshBase(
      dependencies.repositoryPath,
      change.baseRef,
      change.baseRemoteUrl,
    );
    if (!refreshedBase.ok) return refreshedBase;
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
    const candidate = yield* dependencies.captureCandidate({
      cwd: change.worktreePath,
      changeId: change.id,
      now: input.now,
      changeBaseSha: refreshedBase.base.commit,
    });
    if (!candidate.ok) return candidate;
    if (candidate.trackedTreeMatchesChangeBase) {
      if (change.taskId === null) {
        return { ok: true, status: "nothing_to_submit", changeId: change.id } as const;
      }
      if (change.publication === null) {
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
          true,
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
        if (!policy.resolved.acceptanceContextSupplied) {
          return {
            ok: false,
            code: "validation_policy_invalid",
            message:
              "Task-backed no-change submission requires an Acceptance Context validation policy.",
          } as const;
        }
        return yield* validateAndCompleteNoChange(
          dependencies,
          change,
          candidate,
          policy.resolved,
          input.now,
          input.progress,
        );
      }
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

const validateAndCompleteNoChange = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ReadyChange,
  candidate: CapturedCandidate,
  policy: Extract<ResolvedCandidateValidationPolicy, { readonly acceptanceContextSupplied: true }>,
  now: string,
  progress: SubmitProgress | undefined,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    if (change.taskId === null || change.acceptanceContext === null) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: "Task-backed no-change submission requires Acceptance Context.",
      } as const;
    }
    if (!policy.acceptanceContextSupplied) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message:
          "Task-backed no-change submission requires an Acceptance Context validation policy.",
      } as const;
    }
    const task = yield* dependencies.taskPersistence.getTaskById(change.taskId);
    const alreadyCompletedNoChange = task?.state === "done" && task.completionKind === "no_change";
    if (
      !alreadyCompletedNoChange &&
      !(yield* transitionTask(dependencies.persistence, change, "validating", now))
    ) {
      return taskTransitionFailure(change);
    }
    const validation = yield* CandidateValidation;
    const validationResult = yield* validation.validateNoChange({
      changeId: change.id,
      ...candidateIdentity(candidate),
      resourceRoot: change.worktreePath,
      noChange: true,
      acceptanceContext: change.acceptanceContext,
      ...(progress === undefined ? {} : { progress }),
      blockerHistory: (yield* dependencies.persistence.listImplementationBlockers?.(change.id) ??
        Effect.succeed(undefined)) ?? {
        blockers: [],
        resolutions: [],
        active: null,
      },
      ...(change.implementationDecisions === undefined
        ? {}
        : { implementationDecisions: change.implementationDecisions }),
      policy: policy.policy,
      now,
    });
    if ("code" in validationResult) {
      return {
        ok: false,
        code: "active_validation_run",
        changeId: change.id,
        validationRunId: validationResult.validationRunId,
      } as const;
    }
    if (validationResult.outcome !== "passed") {
      return yield* blockedValidationResult(
        validation,
        dependencies,
        change,
        candidate,
        {
          validationRunId: validationResult.validationRunId,
          outcome: validationResult.outcome === "blocked" ? "blocked" : "tooling_failed",
          ...(validationResult.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: validationResult.reviewerEvidence }),
          ...(validationResult.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: validationResult.specialistReviewerEvidence }),
        },
        now,
      );
    }
    if (!validationResult.ok) {
      return yield* Effect.die(new Error("Unexpected active Validation Run result."));
    }
    const completed = yield* dependencies.persistence.completeNoChange({
      changeId: change.id,
      taskId: change.taskId,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      now,
    });
    if (!completed.ok) return taskTransitionFailure(change);
    return {
      ok: true,
      status: "no_change",
      changeId: change.id,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      completionKind: "no_change",
      ...(validationResult.reviewerEvidence === undefined
        ? {}
        : { reviewerEvidence: validationResult.reviewerEvidence }),
      ...(validationResult.specialistReviewerEvidence === undefined
        ? {}
        : { specialistReviewerEvidence: validationResult.specialistReviewerEvidence }),
    } as const;
  });

const reconcileBeforeSubmission = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ReadyChange,
  now: string,
): Effect.Effect<ReconciliationDecision, RepositoryStorageError> =>
  Effect.gen(function* () {
    const reconciliation = yield* dependencies.reconciliation.reconcile({
      repositoryCommonDirectory: dependencies.repositoryCommonDirectory,
      changeId: change.id,
      now,
    });
    const reconciled = reconciliation.changes[0];
    if (reconciled === undefined) {
      return { proceed: false, result: { ok: false, code: "change_not_found" } };
    }
    if (reconciled.status === "rejected" && reconciled.rejection !== "head_sha_mismatch") {
      return {
        proceed: false,
        result: { ok: false, code: "reconciliation_rejected", change: reconciled },
      };
    }
    if (
      reconciled.status === "completed" ||
      reconciled.status === "cleanup_complete" ||
      reconciled.status === "cleanup_pending"
    ) {
      return { proceed: false, result: { ok: true, status: "reconciled", change: reconciled } };
    }
    if (reconciled.status === "closed_unmerged") {
      return {
        proceed: false,
        result: { ok: false, code: "owned_pull_request_closed", changeId: change.id },
      };
    }
    return { proceed: true, reconciled };
  });

const validateAndPublish = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ReadyChange,
  candidate: CapturedCandidate,
  policy: ResolvedCandidateValidationPolicy,
  target: ChangePublicationTarget,
  now: string,
  progress: SubmitProgress | undefined,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    if (
      change.taskId !== null &&
      !(yield* transitionTask(dependencies.persistence, change, "validating", now))
    ) {
      return taskTransitionFailure(change);
    }

    const validation = yield* CandidateValidation;
    const validationResult =
      policy.acceptanceContextSupplied && change.acceptanceContext !== null
        ? yield* validation.validateAcceptanceContextCandidate({
            changeId: change.id,
            ...candidateIdentity(candidate),
            resourceRoot: change.worktreePath,
            acceptanceContext: change.acceptanceContext,
            blockerHistory: (yield* dependencies.persistence.listImplementationBlockers?.(
              change.id,
            ) ?? Effect.succeed(undefined)) ?? { blockers: [], resolutions: [], active: null },
            ...(change.implementationDecisions === undefined
              ? {}
              : { implementationDecisions: change.implementationDecisions }),
            policy: policy.policy,
            ...(progress === undefined ? {} : { progress }),
            now,
          })
        : yield* validation.validateCandidate({
            changeId: change.id,
            ...candidateIdentity(candidate),
            resourceRoot: change.worktreePath,
            ...(change.implementationDecisions === undefined
              ? {}
              : { implementationDecisions: change.implementationDecisions }),
            policy: policy.policy,
            ...(progress === undefined ? {} : { progress }),
            now,
          });
    if ("code" in validationResult) {
      return {
        ok: false,
        code: "active_validation_run",
        changeId: change.id,
        validationRunId: validationResult.validationRunId,
      } as const;
    }
    if (validationResult.outcome !== "passed") {
      return yield* blockedValidationResult(
        validation,
        dependencies,
        change,
        candidate,
        {
          validationRunId: validationResult.validationRunId,
          outcome: validationResult.outcome === "blocked" ? "blocked" : "tooling_failed",
          ...(validationResult.reviewerEvidence === undefined
            ? {}
            : { reviewerEvidence: validationResult.reviewerEvidence }),
          ...(validationResult.specialistReviewerEvidence === undefined
            ? {}
            : { specialistReviewerEvidence: validationResult.specialistReviewerEvidence }),
        },
        now,
      );
    }
    if (!validationResult.ok) {
      return yield* Effect.die(new Error("Unexpected active Validation Run result."));
    }

    const publication = yield* dependencies.publicationFor(change.worktreePath).publish({
      changeId: change.id,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      changeBaseSha: candidate.changeBaseSha,
      policy: {
        ...policy.policy,
        ...(change.acceptanceContext === null
          ? {}
          : { acceptanceContext: change.acceptanceContext }),
      },
      target,
      now,
    });
    if (!publication.ok) {
      return yield* restoreImplementationThen(dependencies, change, publication, now);
    }
    if (
      change.taskId !== null &&
      !(yield* transitionTask(dependencies.persistence, change, "ready", now))
    ) {
      return taskTransitionFailure(change);
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
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ReadyChange,
  candidate: CapturedCandidate,
  validation: {
    readonly outcome: "blocked" | "tooling_failed";
    readonly validationRunId: string;
    readonly reviewerEvidence?: ReviewerContinuityEvidence;
    readonly specialistReviewerEvidence?: readonly SpecialistReviewerContinuityEvidence[];
  },
  now: string,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (
      change.taskId !== null &&
      !(yield* transitionTask(dependencies.persistence, change, "implementing", now))
    ) {
      return taskTransitionFailure(change);
    }
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

const restoreImplementationThen = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ChangeRecord,
  result: ChangeSubmitResult,
  now: string,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
  Effect.map(
    transitionTask(dependencies.persistence, change, "implementing", now),
    (transitioned) =>
      change.taskId !== null && !transitioned ? taskTransitionFailure(change) : result,
  );

const githubTargetFailure = (
  target: Exclude<PublicationTargetDetectionResult, { readonly ok: true }>,
): ChangeSubmitResult => ({
  ok: false,
  code: target.code === "PR_TARGET_NOT_FOUND" ? "github_target_not_found" : "github_tooling_error",
});

const taskTransitionFailure = (change: ChangeRecord): ChangeSubmitResult => ({
  ok: false,
  code: "task_transition_failed",
  changeId: change.id,
});

const selectReadyChange = (
  persistence: ChangePersistence,
  changeId: string,
): Effect.Effect<
  | { readonly ok: true; readonly change: ChangeRecord & { readonly worktreePath: string } }
  | Extract<
      ChangeSubmitResult,
      {
        readonly code:
          | "change_not_found"
          | "change_not_open"
          | "change_blocked"
          | "change_not_ready";
      }
    >,
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    const change = yield* persistence.getChangeById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state === changeState.blocked) return { ok: false, code: "change_blocked" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    if (change.readiness !== changeReadiness.ready || change.worktreePath === null) {
      return { ok: false, code: "change_not_ready", change };
    }
    return { ok: true, change: change as ChangeRecord & { readonly worktreePath: string } };
  });

const candidateIdentity = (candidate: CapturedCandidate) => ({
  candidateId: candidate.candidateId,
  changeBaseSha: candidate.changeBaseSha,
  headSha: candidate.headSha,
});

const transitionTask = (
  changes: Pick<ChangePersistence, "transitionLinkedTask">,
  change: ChangeRecord,
  to: TaskState,
  now: string,
): Effect.Effect<boolean, RepositoryStorageError> =>
  change.taskId === null
    ? Effect.succeed(false)
    : changes.transitionLinkedTask({
        changeId: change.id,
        taskId: change.taskId,
        to,
        now,
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
