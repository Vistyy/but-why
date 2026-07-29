import { Effect } from "effect";

import type { AgentEnvironmentCommand } from "../agent/agentEnvironment.js";
import type { CandidateValidationPolicyResolution } from "./candidateValidation/resolveCandidateValidationPolicy.js";
import type { ReviewerContinuityEvidence } from "./acceptanceReview/runAcceptanceReviewPhase.js";
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
    }
  | {
      readonly ok: false;
      readonly code: "validation_tooling_failed";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly toolingFailures: readonly CandidateValidationToolingFailure[];
      readonly reviewerEvidence?: ReviewerContinuityEvidence;
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
  | { readonly ok: false; readonly code: "validation_policy_invalid"; readonly message: string }
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

export type ChangeSubmitInput = {
  readonly changeId: string;
  readonly now: string;
};

export type AgentEnvironmentResolution =
  | { readonly ok: true }
  | { readonly ok: true; readonly command: AgentEnvironmentCommand }
  | { readonly ok: false; readonly message: string };

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
  readonly resolvePolicy: (
    taskBacked: boolean,
    worktreePath: string,
  ) => CandidateValidationPolicyResolution;
  readonly resolveAgentEnvironment?: (worktreePath: string) => AgentEnvironmentResolution;
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
}): CandidateValidationChangeSubmit => ({
  submit: (input) => submitChange(dependencies, input),
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
            !(yield* transitionTask(dependencies.taskPersistence, change, "ready", input.now))
          ) {
            return taskTransitionFailure(change);
          }
          return publishedResult(change, false);
        }
      }
    }
    const agentEnvironment =
      dependencies.resolveAgentEnvironment?.(change.worktreePath) ?? ({ ok: true } as const);
    if (!agentEnvironment.ok) {
      return { ok: false, code: "validation_policy_invalid", message: agentEnvironment.message };
    }
    const agentEnvironmentCommand =
      "command" in agentEnvironment ? agentEnvironment.command : undefined;
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
      if (change.taskId === null) {
        return { ok: true, status: "nothing_to_submit", changeId: change.id } as const;
      }
      if (change.publication === null) {
        return yield* validateAndCompleteNoChange(
          dependencies,
          change,
          candidate,
          input.now,
          agentEnvironmentCommand,
        );
      }
    }
    const target = detectPublicationTarget(dependencies, change, candidate);
    if (!target.ok) return githubTargetFailure(target);
    return yield* validateAndPublish(
      dependencies,
      change,
      candidate,
      target.target,
      input.now,
      agentEnvironmentCommand,
    );
  });

const validateAndCompleteNoChange = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ReadyChange,
  candidate: CapturedCandidate,
  now: string,
  agentEnvironment: AgentEnvironmentCommand | undefined,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    if (change.taskId === null || change.acceptanceContext === null) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: "Task-backed no-change submission requires Acceptance Context.",
      } as const;
    }
    const policy = dependencies.resolvePolicy(true, change.worktreePath);
    if (!policy.ok || !policy.resolved.taskBacked) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: policy.ok
          ? "Task-backed no-change submission requires a Task-backed validation policy."
          : policy.error.message,
      } as const;
    }
    const task = yield* dependencies.taskPersistence.getTaskById(change.taskId);
    const alreadyCompletedNoChange = task?.state === "done" && task.completionKind === "no_change";
    if (
      !alreadyCompletedNoChange &&
      !(yield* transitionTask(dependencies.taskPersistence, change, "validating", now))
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
      blockerHistory: (yield* dependencies.persistence.listImplementationBlockers(change.id)) ?? {
        blockers: [],
        resolutions: [],
        active: null,
      },
      ...(change.implementationDecisions === undefined
        ? {}
        : { implementationDecisions: change.implementationDecisions }),
      policy: withAgentEnvironment(policy.resolved.policy, agentEnvironment),
      now,
    });
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
        },
        now,
      );
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
  target: ChangePublicationTarget,
  now: string,
  agentEnvironment: AgentEnvironmentCommand | undefined,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    const policy = dependencies.resolvePolicy(
      change.acceptanceContext !== null,
      change.worktreePath,
    );
    if (!policy.ok) {
      return {
        ok: false,
        code: "validation_policy_invalid",
        message: policy.error.message,
      } as const;
    }
    if (
      change.taskId !== null &&
      !(yield* transitionTask(dependencies.taskPersistence, change, "validating", now))
    ) {
      return taskTransitionFailure(change);
    }

    const validation = yield* CandidateValidation;
    const validationResult =
      policy.resolved.taskBacked && change.acceptanceContext !== null
        ? yield* validation.validateTaskBackedCandidate({
            changeId: change.id,
            ...candidateIdentity(candidate),
            resourceRoot: change.worktreePath,
            acceptanceContext: change.acceptanceContext,
            blockerHistory: (yield* dependencies.persistence.listImplementationBlockers(
              change.id,
            )) ?? { blockers: [], resolutions: [], active: null },
            ...(change.implementationDecisions === undefined
              ? {}
              : { implementationDecisions: change.implementationDecisions }),
            policy: withAgentEnvironment(policy.resolved.policy, agentEnvironment),
            now,
          })
        : yield* validation.validateCandidate({
            changeId: change.id,
            ...candidateIdentity(candidate),
            resourceRoot: change.worktreePath,
            ...(change.implementationDecisions === undefined
              ? {}
              : { implementationDecisions: change.implementationDecisions }),
            policy: withAgentEnvironment(policy.resolved.policy, agentEnvironment),
            now,
          });
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
        },
        now,
      );
    }

    const publication = yield* dependencies.publicationFor(change.worktreePath).publish({
      changeId: change.id,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      policy: withAgentEnvironment(policy.resolved.policy, agentEnvironment),
      target,
      now,
    });
    if (!publication.ok) {
      return yield* restoreImplementationThen(dependencies, change, publication, now);
    }
    if (
      change.taskId !== null &&
      !(yield* transitionTask(dependencies.taskPersistence, change, "ready", now))
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
  },
  now: string,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (
      change.taskId !== null &&
      !(yield* transitionTask(dependencies.taskPersistence, change, "implementing", now))
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
        };
  });

const restoreImplementationThen = (
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ChangeRecord,
  result: ChangeSubmitResult,
  now: string,
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError> =>
  Effect.map(
    transitionTask(dependencies.taskPersistence, change, "implementing", now),
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

const withAgentEnvironment = <Policy extends object>(
  policy: Policy,
  agentEnvironment: AgentEnvironmentCommand | undefined,
): Policy & { readonly agentEnvironment?: AgentEnvironmentCommand } => ({
  ...policy,
  ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
});

const transitionTask = (
  persistence: Pick<TaskPersistence, "getTaskById" | "transitionTaskState">,
  change: ChangeRecord,
  to: TaskState,
  now: string,
): Effect.Effect<boolean, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (change.taskId === null) return false;
    if ((yield* persistence.getTaskById(change.taskId))?.state === to) return true;
    return (yield* persistence.transitionTaskState({ taskId: change.taskId, to, now })).ok;
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
