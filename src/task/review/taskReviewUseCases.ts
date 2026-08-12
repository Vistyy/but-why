import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { repoAgentEnvironment } from "../../agent/agentEnvironment.js";
import {
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import { decodeReviewerOutputContract, type ReviewerOutput } from "../../agent/reviewerOutput.js";
import {
  executeReviewerSession,
  type ReviewerExecutionEvidence,
} from "../../agent/reviewerSession/executeReviewerSession.js";
import {
  type ReviewerSessionStore,
  reviewerSessionsOwnerRoot,
} from "../../agent/reviewerSession/reviewerSession.js";
import { discoverObservedReviewerTranscripts } from "../../agent/reviewerSession/reviewerTranscript.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  DisposableWorktreeInspection,
  ExactDisposableWorkspaceCleanupInput,
  ExactDisposableWorkspaceCleanupResult,
} from "../../disposableWorkspace/disposableWorkspace.js";
import { expectedDisposableWorkspacePath } from "../../disposableWorkspace/disposableWorkspacePath.js";
import type { RunDisposableExactCommitWorkspace } from "../../disposableWorkspace/runDisposableExactCommitWorkspace.js";
import { runRepositoryPreparationEffect } from "../../repositoryPreparation/runRepositoryPreparation.js";
import { buildTaskReviewerPrompt } from "../../reviewerPrompts/taskReviewerPrompt.js";
import type { PublicTaskId } from "../taskId.js";
import type { TaskReviewBase, TaskReviewRecord, TaskReviewToolingFailure } from "./taskReview.js";
import type { TaskReviewPolicyResolutionResult } from "./taskReviewConfig.js";
import type { TaskReviewPersistence } from "./taskReviewPersistence.js";

export type TaskReviewSubmitResult =
  | { readonly ok: true; readonly review: TaskReviewRecord }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: string }
  | { readonly ok: false; readonly code: "active_task_review"; readonly reviewId: string }
  | { readonly ok: false; readonly code: "review_base_unavailable"; readonly message: string }
  | { readonly ok: false; readonly code: "task_review_config_invalid"; readonly message: string }
  | {
      readonly ok: false;
      readonly code: "task_review_recovery_required";
      readonly review: TaskReviewRecord;
    };

export type TaskReviewAbandonResult =
  | { readonly ok: true; readonly review: TaskReviewRecord }
  | { readonly ok: false; readonly code: "task_review_not_found" | "task_review_not_active" }
  | {
      readonly ok: false;
      readonly code: "task_review_cleanup_failed";
      readonly review: TaskReviewRecord;
      readonly message: string;
    };

export type TaskReviewIdentityInspection =
  | {
      readonly verified: true;
      readonly workspace: Extract<DisposableWorktreeInspection, { state: "absent" | "matching" }>;
    }
  | { readonly verified: false; readonly message: string };

export type TaskReviewInspectionUseCases = {
  readonly getById: (
    reviewId: string,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly getLatestForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<TaskReviewRecord | undefined, RepositoryStorageError>;
  readonly listForTask: (
    taskId: PublicTaskId,
  ) => Effect.Effect<readonly TaskReviewRecord[], RepositoryStorageError>;
  readonly proposalIsCurrent: (
    review: TaskReviewRecord,
  ) => Effect.Effect<boolean, RepositoryStorageError>;
  readonly inspectIdentity: (
    review: TaskReviewRecord,
  ) => Effect.Effect<TaskReviewIdentityInspection>;
};

export type TaskReviewRecoveryUseCases = {
  readonly abandon: (
    reviewId: string,
    reason: string,
    now: string,
  ) => Effect.Effect<TaskReviewAbandonResult, RepositoryStorageError>;
};

export type TaskReviewSubmissionUseCases = {
  readonly submit: (
    taskId: PublicTaskId,
    now: string,
  ) => Effect.Effect<TaskReviewSubmitResult, RepositoryStorageError>;
};

export type TaskReviewUseCases = TaskReviewInspectionUseCases &
  TaskReviewRecoveryUseCases &
  TaskReviewSubmissionUseCases;

type WorkspaceExecution =
  | {
      readonly ok: true;
      readonly output: ReviewerOutput;
      readonly evidence: ReviewerExecutionEvidence;
      readonly sessionReference: string | null;
    }
  | {
      readonly ok: false;
      readonly failure: TaskReviewToolingFailure;
      readonly evidence?: ReviewerExecutionEvidence;
      readonly sessionReference?: string | null;
      readonly findings?: ReviewerOutput["findings"];
    };

export const openTaskReviewUseCases = (input: {
  readonly mainCheckoutRoot: string;
  readonly loadRepoConfig: (
    commit: string,
  ) =>
    | { readonly ok: true; readonly config: RepoConfig }
    | { readonly ok: false; readonly message: string };
  readonly resolvePolicy: (
    repoConfig: RepoConfig,
    baseCommit: string,
  ) => TaskReviewPolicyResolutionResult;
  readonly persistence: TaskReviewPersistence;
  readonly reviewerSessionStorageRoot: string;
  readonly reviewerRuntime: ReviewerAgentRuntime<ReviewerOutput>;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly readReviewBase: (
    mainCheckoutRoot: string,
  ) => Effect.Effect<
    | { readonly ok: true; readonly base: TaskReviewBase }
    | { readonly ok: false; readonly message: string }
  >;
  readonly verifyReviewBase: (
    mainCheckoutRoot: string,
    recorded: TaskReviewBase,
  ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly runWorkspace: RunDisposableExactCommitWorkspace;
  readonly cleanupWorkspace: (
    mainCheckoutRoot: string,
    cleanup: ExactDisposableWorkspaceCleanupInput,
  ) => Effect.Effect<ExactDisposableWorkspaceCleanupResult>;
  readonly inspectWorkspace: (
    mainCheckoutRoot: string,
    workspaceId: string,
    expectedCommitSha: string,
    worktreePath: string,
  ) => Effect.Effect<DisposableWorktreeInspection>;
}): TaskReviewUseCases => ({
  submit: (taskId, now) => submitTaskReview(input, taskId, now),
  abandon: (reviewId, reason, now) => abandonTaskReview(input, reviewId, reason, now),
  getById: input.persistence.getById,
  getLatestForTask: input.persistence.getLatestForTask,
  listForTask: input.persistence.listForTask,
  proposalIsCurrent: input.persistence.proposalIsCurrent,
  inspectIdentity: (review) => inspectTaskReviewIdentity(input, review),
});

const submitTaskReview = (
  input: Parameters<typeof openTaskReviewUseCases>[0],
  taskId: PublicTaskId,
  now: string,
): Effect.Effect<TaskReviewSubmitResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const base = yield* input.readReviewBase(input.mainCheckoutRoot);
    if (!base.ok)
      return { ok: false, code: "review_base_unavailable", message: base.message } as const;
    const config = input.loadRepoConfig(base.base.commit);
    if (!config.ok)
      return { ok: false, code: "review_base_unavailable", message: config.message } as const;
    const repoConfig = config.config;
    const resolvedPolicy = input.resolvePolicy(repoConfig, base.base.commit);
    if (!resolvedPolicy.ok) {
      return {
        ok: false,
        code: "task_review_config_invalid",
        message: resolvedPolicy.message,
      } as const;
    }
    const reviewId = randomUUID();
    const workspacePath = expectedDisposableWorkspacePath(input.mainCheckoutRoot, reviewId);
    const admitted = yield* input.persistence.admit({
      reviewId,
      taskId,
      policy: resolvedPolicy.policy.snapshot,
      baseRef: base.base.ref,
      baseCommit: base.base.commit,
      workspacePath,
      now,
    });
    if (!admitted.ok) return admitted;

    const workspace = yield* input.runWorkspace<WorkspaceExecution, RepositoryStorageError>({
      repoRoot: input.mainCheckoutRoot,
      workspaceId: reviewId,
      commitSha: base.base.commit,
      copyFiles: repoConfig.snapshotWorkspace?.copyFiles ?? [],
      recordWorkspaceCleanup: (cleanup) =>
        input.persistence.recordCleanup(reviewId, cleanup.workspace, now),
      runInWorkspace: (active) =>
        Effect.gen(function* () {
          const prepare = repoConfig.prepare;
          if (prepare !== undefined) {
            const prepared = yield* Effect.either(
              runRepositoryPreparationEffect({
                prepare: {
                  command: prepare.command,
                  timeoutSeconds: prepare.timeoutSeconds ?? 1200,
                },
                exec: active.commandExecutor,
              }),
            );
            if (prepared._tag === "Left") {
              return {
                ok: false,
                failure: {
                  operation: "run_repository_preparation",
                  message: prepared.left.message,
                },
              } as const;
            }
            if (prepared.right.exitCode !== 0) {
              return {
                ok: false,
                failure: {
                  operation: "run_repository_preparation",
                  message: prepared.right.timedOut
                    ? "Repository Preparation timed out."
                    : `Repository Preparation exited with code ${prepared.right.exitCode}.`,
                },
              } as const;
            }
          }
          const agentEnvironment = repoAgentEnvironment(repoConfig);
          const history = yield* input.persistence.listForTask(taskId);
          const previous = history.length < 2 ? undefined : history.at(-2);
          const prompt = buildTaskReviewerPrompt({
            policy: resolvedPolicy.policy.snapshot,
            proposal: admitted.proposal,
            dependencyEvidence: admitted.dependencyEvidence,
          });
          const sessionStore: ReviewerSessionStore = {
            get: input.persistence.getReviewerSession,
            save: input.persistence.saveReviewerSession,
            remove: input.persistence.removeReviewerSession,
          };
          const execution = yield* executeReviewerSession<ReviewerOutput, never>({
            identity: {
              owner: { kind: "task", id: taskId },
              producer: "task",
              agentProfile: resolvedPolicy.policy.profile,
              instructions: JSON.stringify(resolvedPolicy.policy.snapshot),
              ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
              resources: {
                ...(resolvedPolicy.policy.profile.profile.runtimeConfig?.extensions === undefined
                  ? {}
                  : {
                      extensions: resolvedPolicy.policy.profile.profile.runtimeConfig.extensions,
                    }),
                ...(resolvedPolicy.policy.profile.profile.runtimeConfig?.skills === undefined
                  ? {}
                  : { skills: resolvedPolicy.policy.profile.profile.runtimeConfig.skills }),
                ...(resolvedPolicy.policy.profile.profile.runtimeConfig?.tools === undefined
                  ? {}
                  : { tools: resolvedPolicy.policy.profile.profile.runtimeConfig.tools }),
              },
            },
            runtime: input.reviewerRuntime,
            reviewerExecutor: input.reviewerExecutor,
            decodeOutput: (output, reviewCall) =>
              decodeReviewerOutputContract({ reviewer: "task", attempts: reviewCall, output }).pipe(
                Effect.mapError(
                  (error) =>
                    new ReviewerExecutionFailed({
                      kind: "output_contract",
                      operationName: error.operationName,
                      message: error.message,
                      diagnostics: error.diagnostics,
                    }),
                ),
                Effect.flatMap((report) =>
                  report.findings.every((finding) => finding.artifactRefs.length === 0)
                    ? Effect.succeed(report)
                    : Effect.fail(
                        new ReviewerExecutionFailed({
                          kind: "output_contract",
                          operationName: "decode_task_review_output",
                          message: "Task Review Findings must use an empty artifactRefs array.",
                        }),
                      ),
                ),
              ),
            prompt,
            continuationPrompt: buildTaskReviewContinuationPrompt({
              previousProposal: previous?.proposal,
              currentPrompt: prompt,
              currentProposal: admitted.proposal,
            }),
            commandCwd: active.worktreePath,
            resourceRoot: active.worktreePath,
            sessionStorageRoot: input.reviewerSessionStorageRoot,
            sessionStore,
            completeReview: ({ initialResult }) => Effect.succeed(initialResult),
          });
          const reviewed = execution.result;
          const sessionReference = reviewed.sessionReference ?? null;
          return reviewed.ok
            ? ({
                ok: true,
                output: reviewed.report,
                evidence: execution.evidence,
                sessionReference,
              } as const)
            : ({
                ok: false,
                failure: {
                  operation: reviewed.failure.operationName,
                  message: reviewed.failure.message,
                },
                evidence: execution.evidence,
                sessionReference,
              } as const);
        }),
    });

    let execution: WorkspaceExecution;
    if (workspace.ok && workspace.workspaceResult !== undefined) {
      execution = workspace.workspaceResult;
    } else {
      const tooling = workspace.ok
        ? { operation: "run_task_review", message: "Task reviewer produced no result." }
        : {
            operation: workspace.toolingError.operationName,
            message: workspace.toolingError.errorMessage,
          };
      if (!workspace.ok && workspace.toolingError.cleanupResult.workspace !== "removed") {
        const cleanup = yield* input.cleanupWorkspace(input.mainCheckoutRoot, {
          workspaceId: reviewId,
          expectedCommitSha: base.base.commit,
          recordedWorktreePath: workspacePath,
        });
        yield* input.persistence.recordCleanup(reviewId, cleanup.workspace, now);
        if (cleanup.workspace !== "removed") {
          const active = yield* input.persistence.getById(reviewId);
          if (active === undefined) return { ok: false, code: "task_review_not_found" } as never;
          return { ok: false, code: "task_review_recovery_required", review: active } as const;
        }
      }
      execution = { ok: false, failure: tooling };
    }

    if (execution.evidence !== undefined) {
      const executionInput = {
        reviewId,
        execution: {
          ...execution.evidence,
          sessionReference: execution.sessionReference ?? null,
        },
      };
      const recordedExecution = yield* Effect.either(
        recordTaskReviewExecutionWithRetry(input.persistence.recordExecution, executionInput),
      );
      if (recordedExecution._tag === "Left") {
        const failure = {
          operation: "record_task_review_execution",
          message: repositoryStorageErrorMessage("Task Review execution", recordedExecution.left),
          pendingExecution: executionInput.execution,
        };
        yield* input.persistence.recordActiveFailure(reviewId, failure, now);
        const active = yield* input.persistence.getById(reviewId);
        if (active === undefined) return { ok: false, code: "task_review_not_found" } as never;
        return { ok: false, code: "task_review_recovery_required", review: active } as const;
      }
    }

    const transcriptDiscovery = discoverObservedReviewerTranscripts(
      reviewerSessionsOwnerRoot(input.reviewerSessionStorageRoot, taskId),
      taskId,
    );
    if (!transcriptDiscovery.ok) {
      const failure = {
        operation: "index_task_reviewer_transcripts",
        message: transcriptDiscovery.reason,
      };
      yield* input.persistence.recordActiveFailure(reviewId, failure, now);
      const active = yield* input.persistence.getById(reviewId);
      if (active === undefined) return { ok: false, code: "task_review_not_found" } as never;
      return { ok: false, code: "task_review_recovery_required", review: active } as const;
    }
    const indexed = yield* Effect.either(
      input.persistence.recordTranscripts({
        reviewId,
        taskId,
        transcripts: transcriptDiscovery.transcripts,
      }),
    );
    if (indexed._tag === "Left") {
      const failure = {
        operation: "index_task_reviewer_transcripts",
        message: repositoryStorageErrorMessage("Task Reviewer Transcript", indexed.left),
      };
      yield* input.persistence.recordActiveFailure(reviewId, failure, now);
      const active = yield* input.persistence.getById(reviewId);
      if (active === undefined) return { ok: false, code: "task_review_not_found" } as never;
      return { ok: false, code: "task_review_recovery_required", review: active } as const;
    }

    const completed = yield* input.persistence.complete({
      reviewId,
      findings: execution.ok ? execution.output.findings : (execution.findings ?? []),
      ...(execution.ok ? {} : { toolingFailure: execution.failure }),
      now,
    });
    if (!completed.ok) {
      const active = yield* input.persistence.getById(reviewId);
      if (active === undefined) return { ok: false, code: "task_review_not_found" } as never;
      return { ok: false, code: "task_review_recovery_required", review: active } as const;
    }
    return { ok: true, review: completed.review } as const;
  });

export const inspectTaskReviewIdentity = (
  input: {
    readonly mainCheckoutRoot: string;
    readonly verifyReviewBase: (
      mainCheckoutRoot: string,
      recorded: TaskReviewBase,
    ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
    readonly inspectWorkspace: (
      mainCheckoutRoot: string,
      workspaceId: string,
      expectedCommitSha: string,
      worktreePath: string,
    ) => Effect.Effect<DisposableWorktreeInspection>;
  },
  review: TaskReviewRecord,
): Effect.Effect<TaskReviewIdentityInspection> =>
  Effect.gen(function* () {
    const base = yield* input.verifyReviewBase(input.mainCheckoutRoot, {
      ref: review.baseRef,
      commit: review.baseCommit,
    });
    if (!base.ok) return { verified: false, message: base.message } as const;
    const workspace = yield* input.inspectWorkspace(
      input.mainCheckoutRoot,
      review.id,
      review.baseCommit,
      review.workspacePath,
    );
    return workspace.state === "unproven"
      ? ({ verified: false, message: workspace.message } as const)
      : ({ verified: true, workspace } as const);
  });

export const abandonTaskReview = (
  input: {
    readonly mainCheckoutRoot: string;
    readonly reviewerSessionStorageRoot: string;
    readonly persistence: TaskReviewPersistence;
    readonly verifyReviewBase: (
      mainCheckoutRoot: string,
      recorded: TaskReviewBase,
    ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
    readonly cleanupWorkspace: (
      mainCheckoutRoot: string,
      cleanup: ExactDisposableWorkspaceCleanupInput,
    ) => Effect.Effect<ExactDisposableWorkspaceCleanupResult>;
  },
  reviewId: string,
  reason: string,
  now: string,
): Effect.Effect<TaskReviewAbandonResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const review = yield* input.persistence.getById(reviewId);
    if (review === undefined) return { ok: false, code: "task_review_not_found" } as const;
    if (review.state !== "running") return { ok: false, code: "task_review_not_active" } as const;
    const base = yield* input.verifyReviewBase(input.mainCheckoutRoot, {
      ref: review.baseRef,
      commit: review.baseCommit,
    });
    if (!base.ok) {
      return {
        ok: false,
        code: "task_review_cleanup_failed",
        review,
        message: base.message,
      } as const;
    }
    const cleanup = yield* input.cleanupWorkspace(input.mainCheckoutRoot, {
      workspaceId: review.id,
      expectedCommitSha: review.baseCommit,
      recordedWorktreePath: review.workspacePath,
    });
    yield* input.persistence.recordCleanup(review.id, cleanup.workspace, now);
    if (cleanup.workspace !== "removed") {
      const current = yield* input.persistence.getById(review.id);
      return {
        ok: false,
        code: "task_review_cleanup_failed",
        review: current ?? review,
        message: cleanup.errorMessage ?? "Task Review workspace cleanup failed.",
      } as const;
    }
    const pendingExecution = review.toolingFailure?.pendingExecution;
    if (pendingExecution !== undefined) {
      const recordedExecution = yield* Effect.either(
        recordTaskReviewExecutionWithRetry(input.persistence.recordExecution, {
          reviewId: review.id,
          execution: pendingExecution,
        }),
      );
      if (recordedExecution._tag === "Left") {
        const failure = {
          operation: "record_task_review_execution",
          message: repositoryStorageErrorMessage("Task Review execution", recordedExecution.left),
          pendingExecution,
        };
        yield* input.persistence.recordActiveFailure(review.id, failure, now);
        const current = yield* input.persistence.getById(review.id);
        return {
          ok: false,
          code: "task_review_cleanup_failed",
          review: current ?? review,
          message: failure.message,
        } as const;
      }
    }

    const transcriptDiscovery = discoverObservedReviewerTranscripts(
      reviewerSessionsOwnerRoot(input.reviewerSessionStorageRoot, review.taskId),
      review.taskId,
    );
    if (!transcriptDiscovery.ok) {
      const failure = {
        operation: "index_task_reviewer_transcripts",
        message: transcriptDiscovery.reason,
      };
      yield* input.persistence.recordActiveFailure(review.id, failure, now);
      const current = yield* input.persistence.getById(review.id);
      return {
        ok: false,
        code: "task_review_cleanup_failed",
        review: current ?? review,
        message: failure.message,
      } as const;
    }
    const indexed = yield* Effect.either(
      input.persistence.recordTranscripts({
        reviewId: review.id,
        taskId: review.taskId,
        transcripts: transcriptDiscovery.transcripts,
      }),
    );
    if (indexed._tag === "Left") {
      const failure = {
        operation: "index_task_reviewer_transcripts",
        message: repositoryStorageErrorMessage("Task Reviewer Transcript", indexed.left),
      };
      yield* input.persistence.recordActiveFailure(review.id, failure, now);
      const current = yield* input.persistence.getById(review.id);
      return {
        ok: false,
        code: "task_review_cleanup_failed",
        review: current ?? review,
        message: failure.message,
      } as const;
    }
    const abandoned = yield* input.persistence.abandon(review.id, reason, now);
    return abandoned.ok ? { ok: true, review: abandoned.review } : abandoned;
  });

const buildTaskReviewContinuationPrompt = (input: {
  readonly previousProposal: TaskReviewRecord["proposal"] | undefined;
  readonly currentProposal: TaskReviewRecord["proposal"];
  readonly currentPrompt: string;
}): string =>
  [
    "Continue the compatible Task Reviewer Session with the complete current proposal below.",
    "Re-evaluate the current proposal. Do not reuse an earlier judgment.",
    "Deterministic proposal diff from the most recent prior Review:",
    JSON.stringify({
      previous: input.previousProposal ?? null,
      current: input.currentProposal,
      changed: proposalDiff(input.previousProposal, input.currentProposal),
    }),
    "",
    input.currentPrompt,
  ].join("\n");

const proposalDiff = (
  previous: TaskReviewRecord["proposal"] | undefined,
  current: TaskReviewRecord["proposal"],
) => ({
  title:
    previous === undefined || previous.title === current.title
      ? null
      : { before: previous.title, after: current.title },
  description:
    previous === undefined || previous.description === current.description
      ? null
      : { before: previous.description, after: current.description },
  dependencyIds:
    previous === undefined ||
    JSON.stringify(previous.dependencyIds) === JSON.stringify(current.dependencyIds)
      ? null
      : { before: previous.dependencyIds, after: current.dependencyIds },
});

export const recordTaskReviewExecutionWithRetry = (
  recordExecution: TaskReviewPersistence["recordExecution"],
  input: Parameters<TaskReviewPersistence["recordExecution"]>[0],
): Effect.Effect<void, RepositoryStorageError> =>
  recordExecution(input).pipe(
    Effect.catchTag("RepositorySqlOperationFailed", () => recordExecution(input)),
  );

const repositoryStorageErrorMessage = (
  subject: "Task Review execution" | "Task Reviewer Transcript",
  error: RepositoryStorageError,
): string =>
  "operationName" in error
    ? `${subject} persistence failed during ${error.operationName}.`
    : `${subject} persistence failed: ${error._tag}.`;
