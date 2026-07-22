import { Effect } from "effect";

import type { CandidateValidationPolicyResolution } from "../candidateValidation/resolveCandidateValidationPolicy.js";
import type {
  CandidateValidationFinding,
  CandidateValidationToolingFailure,
} from "../candidateValidation/candidateValidationRunStore.js";
import {
  CandidateValidation,
  type CandidateValidationService,
} from "../candidateValidation/validateCandidate.js";
import type {
  CaptureLocalCandidateInput,
  CaptureLocalCandidateResult,
} from "../changeCandidateCapture/captureLocalCandidate.js";
import type { RepositoryStorageError } from "../repositoryStorageError.js";
import type {
  CandidatePublication,
  PublishCandidateResult,
} from "../publication/candidatePublication.js";
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
    }
  | {
      readonly ok: false;
      readonly code: "validation_tooling_failed";
      readonly changeId: string;
      readonly candidateId: string;
      readonly validationRunId: string;
      readonly toolingFailures: readonly CandidateValidationToolingFailure[];
    }
  | { readonly ok: false; readonly code: "change_not_found" | "change_not_open" }
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
  readonly persistence: ChangePersistence;
  readonly taskPersistence: Pick<TaskPersistence, "getTaskById" | "transitionTaskState">;
  readonly reconciliation: ChangeReconciliation;
  readonly resolvePolicy: (taskBacked: boolean) => CandidateValidationPolicyResolution;
  readonly publicationFor: (cwd: string) => CandidatePublication;
  readonly detectTarget: (cwd: string, branch: string) => PublicationTargetDetectionResult;
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
    const selected = yield* selectReadyChange(dependencies.persistence, input.changeId);
    if (!selected.ok) return selected;
    const change = selected.change;
    const reconciliation = yield* reconcileBeforeSubmission(dependencies, change, input.now);
    if (!reconciliation.proceed) return reconciliation.result;

    const candidate = yield* dependencies.captureCandidate({
      cwd: change.worktreePath,
      changeId: change.id,
      now: input.now,
    });
    if (!candidate.ok) return candidate;
    if (change.taskId === null && candidate.headSha === candidate.comparisonBaseSha) {
      return { ok: true, status: "nothing_to_submit", changeId: change.id } as const;
    }
    if (isCurrentPublishedCandidate(change, candidate, reconciliation.reconciled)) {
      if (
        change.taskId !== null &&
        !(yield* transitionTask(dependencies.taskPersistence, change, "ready", input.now))
      ) {
        return taskTransitionFailure(change);
      }
      return publishedResult(change, candidate, false);
    }
    const target = detectPublicationTarget(dependencies, change, candidate);
    if (!target.ok) return githubTargetFailure(target);
    return yield* validateAndPublish(dependencies, change, candidate, target.target, input.now);
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
    if (reconciled.status === "rejected") {
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
): Effect.Effect<ChangeSubmitResult, RepositoryStorageError, CandidateValidation> =>
  Effect.gen(function* () {
    const policy = dependencies.resolvePolicy(change.acceptanceContext !== null);
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
            ...candidateIdentity(candidate),
            acceptanceContext: change.acceptanceContext,
            policy: policy.resolved.policy,
            now,
          })
        : yield* validation.validateCandidate({
            ...candidateIdentity(candidate),
            policy: policy.resolved.policy,
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
        },
        now,
      );
    }

    const publication = yield* dependencies.publicationFor(change.worktreePath).publish({
      changeId: change.id,
      candidateId: candidate.candidateId,
      validationRunId: validationResult.validationRunId,
      policy: policy.resolved.policy,
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
    } as const;
  });

const blockedValidationResult = (
  candidateValidation: CandidateValidationService,
  dependencies: Parameters<typeof openChangeSubmit>[0],
  change: ReadyChange,
  candidate: CapturedCandidate,
  validation: { readonly outcome: "blocked" | "tooling_failed"; readonly validationRunId: string },
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

const isCurrentPublishedCandidate = (
  change: ChangeRecord,
  candidate: CapturedCandidate,
  reconciled: ReconciledChange,
): boolean =>
  reconciled.status === "open" &&
  change.publication?.pullRequest !== null &&
  change.publication?.expectedHeadSha === candidate.headSha;

const selectReadyChange = (
  persistence: ChangePersistence,
  changeId: string,
): Effect.Effect<
  | { readonly ok: true; readonly change: ChangeRecord & { readonly worktreePath: string } }
  | Extract<
      ChangeSubmitResult,
      { readonly code: "change_not_found" | "change_not_open" | "change_not_ready" }
    >,
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    const change = yield* persistence.getChangeById(changeId);
    if (change === undefined) return { ok: false, code: "change_not_found" };
    if (change.state !== changeState.open) return { ok: false, code: "change_not_open" };
    if (change.readiness !== changeReadiness.ready || change.worktreePath === null) {
      return { ok: false, code: "change_not_ready", change };
    }
    return { ok: true, change: change as ChangeRecord & { readonly worktreePath: string } };
  });

const candidateIdentity = (candidate: CapturedCandidate) => ({
  candidateId: candidate.candidateId,
  comparisonBaseSha: candidate.comparisonBaseSha,
  headSha: candidate.headSha,
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
  dependencies.detectTarget(change.worktreePath, candidate.branchRef.replace(/^refs\/heads\//, ""));

const publishedResult = (
  change: ChangeRecord,
  candidate: CapturedCandidate,
  created: boolean,
): ChangeSubmitResult => {
  const publication = change.publication;
  if (publication?.pullRequest === null || publication === null) {
    throw new Error("Reconciled Change lacks owned pull request facts");
  }
  return {
    ok: true,
    status: "published",
    changeId: change.id,
    candidateId: candidate.candidateId,
    validationRunId: publication.validationRunId,
    created,
    pullRequest: publication.pullRequest,
  };
};
