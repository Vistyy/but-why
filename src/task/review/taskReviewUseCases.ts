import { Effect } from "effect";
import { repoAgentEnvironment } from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type {
  AgentSessionConfiguration,
  AgentSessionPersistence,
} from "../../agent/agentSession/agentSession.js";
import { executeAgentSession } from "../../agent/agentSession/executeAgentSession.js";
import {
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type {
  DisposableWorktreeInspection,
  ExactDisposableWorkspaceCleanupInput,
  ExactDisposableWorkspaceCleanupResult,
} from "../../disposableWorkspace/disposableWorkspace.js";
import type { RunDisposableExactCommitWorkspace } from "../../disposableWorkspace/runDisposableExactCommitWorkspace.js";
import { runRepositoryPreparationEffect } from "../../repositoryPreparation/runRepositoryPreparation.js";
import {
  buildTaskReviewerPrompt,
  buildTaskReviewerSystemPrompt,
} from "../../reviewerPrompts/taskReviewerPrompt.js";
import {
  runAfterSubmitProgressStarted,
  runWithSubmitProgress,
  type StartedSubmitProgress,
  type SubmitProgress,
  type SubmitProgressProfile,
  startSubmitProgress,
} from "../../submission/submissionProgress.js";
import type { PublicTaskId } from "../taskId.js";
import type {
  TaskReviewBase,
  TaskReviewPolicySnapshot,
  TaskReviewRecord,
  TaskReviewToolingFailure,
} from "./taskReview.js";
import type { TaskReviewPolicyResolutionResult } from "./taskReviewConfig.js";
import { settleTaskReviewEvidence } from "./taskReviewEvidenceSettlement.js";
import { decodeTaskReviewerOutput, type TaskReviewerOutput } from "./taskReviewerOutput.js";
import type {
  CompleteTaskReviewSuccess,
  TaskReviewAdmissionPersistence,
  TaskReviewPersistence,
} from "./taskReviewPersistence.js";
import { taskReviewWorkspaceId } from "./taskReviewWorkspace.js";

export type TaskReviewSubmitResult =
  | CompleteTaskReviewSuccess
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: string }
  | { readonly ok: false; readonly code: "task_change_linked"; readonly changeId: string }
  | { readonly ok: false; readonly code: "active_task_review"; readonly reviewId: number }
  | { readonly ok: false; readonly code: "review_base_unavailable"; readonly message: string }
  | { readonly ok: false; readonly code: "task_review_config_invalid"; readonly message: string }
  | {
      readonly ok: false;
      readonly code: "task_review_recovery_required";
      readonly review: TaskReviewRecord;
    };

export type TaskReviewAbandonResult =
  | {
      readonly ok: true;
      readonly outcome: "tooling_failed";
      readonly review: TaskReviewRecord;
      readonly task: { readonly id: string; readonly state: string };
    }
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
    reviewId: number,
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
    reviewId: number,
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
      readonly output: TaskReviewerOutput;
      readonly sessionReference: string | null;
    }
  | {
      readonly ok: false;
      readonly failure: TaskReviewToolingFailure;
      readonly sessionReference?: string | null;
      readonly findings?: TaskReviewerOutput["findings"];
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
  readonly admission?: TaskReviewAdmissionPersistence;
  readonly agentSessionStorageRoot: string;
  readonly agentPersistence: AgentSessionPersistence;
  readonly reviewerRuntime: ReviewerAgentRuntime<TaskReviewerOutput>;
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
  readonly progress?: SubmitProgress;
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
    const reusableJudgment = yield* input.persistence.reuseJudgment(taskId, now);
    if (reusableJudgment !== undefined) return reusableJudgment;
    const admission = input.admission ?? input.persistence;
    const rejected = yield* admission.checkAdmission(taskId);
    if (rejected !== undefined) return rejected;

    const base = yield* input.readReviewBase(input.mainCheckoutRoot);
    if (!base.ok)
      return { ok: false, code: "review_base_unavailable", message: base.message } as const;
    const config = input.loadRepoConfig(base.base.commit);
    if (!config.ok)
      return { ok: false, code: "review_base_unavailable", message: config.message } as const;
    const repoConfig = config.config;
    const storedPolicy = yield* input.persistence.getReviewerConfiguration(taskId);
    const configurationCanBeCorrected =
      storedPolicy === undefined
        ? false
        : yield* input.persistence.reviewerConfigurationCanBeCorrected(taskId);
    const resolvedPolicy =
      storedPolicy === undefined || configurationCanBeCorrected
        ? input.resolvePolicy(repoConfig, base.base.commit)
        : taskReviewPolicyFromSnapshot(storedPolicy);
    if (!resolvedPolicy.ok) {
      return {
        ok: false,
        code: "task_review_config_invalid",
        message: resolvedPolicy.message,
      } as const;
    }
    const admitted = yield* admission.admit({
      taskId,
      policy: resolvedPolicy.policy.snapshot,
      baseRef: base.base.ref,
      baseCommit: base.base.commit,
      now,
    });
    if (!admitted.ok) return admitted;
    const reviewId = admitted.review.id;

    let taskReviewProgress: StartedSubmitProgress | undefined;
    const result = yield* runAfterSubmitProgressStarted({
      progress: input.progress,
      started: () => taskReviewProgress,
      run: Effect.gen(function* () {
        const workspace = yield* input.runWorkspace<WorkspaceExecution, RepositoryStorageError>({
          repoRoot: input.mainCheckoutRoot,
          workspaceId: taskReviewWorkspaceId(reviewId),
          commitSha: base.base.commit,
          copyFiles: repoConfig.snapshotWorkspace?.copyFiles ?? [],
          runInWorkspace: (active) =>
            Effect.gen(function* () {
              const prepare = repoConfig.prepare;
              if (prepare !== undefined) {
                const prepared = yield* Effect.either(
                  runWithSubmitProgress({
                    progress: input.progress,
                    phase: { kind: "repositoryPreparation" },
                    run: runRepositoryPreparationEffect({
                      prepare: {
                        command: prepare.command,
                        timeoutSeconds: prepare.timeoutSeconds ?? 1200,
                      },
                      exec: active.commandExecutor,
                    }),
                    outcome: (result) => (result.exitCode === 0 ? "passed" : "failed"),
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
              const systemPrompt = buildTaskReviewerSystemPrompt(resolvedPolicy.policy.snapshot);
              const prompt = buildTaskReviewerPrompt({
                proposal: admitted.proposal,
                dependencyEvidence: admitted.dependencyEvidence,
              });
              taskReviewProgress = yield* startSubmitProgress(input.progress, {
                kind: "taskReview",
                profile: taskReviewProgressProfile(resolvedPolicy.policy.profile),
              });
              const decodeOutput = (output: unknown, reviewCall: number) =>
                decodeTaskReviewerOutput({ attempts: reviewCall, output }).pipe(
                  Effect.mapError(
                    (error) =>
                      new ReviewerExecutionFailed({
                        kind: "output_contract",
                        operationName: error.operationName,
                        message: error.message,
                        diagnostics: error.diagnostics,
                      }),
                  ),
                );
              const agentSessionId = yield* input.persistence.getReviewerAgentSession(taskId);
              const execution = yield* executeAgentSession({
                ...(agentSessionId === undefined ? {} : { agentSessionId }),
                configuration: agentConfiguration(resolvedPolicy.policy.profile),
                agentPersistence: input.agentPersistence,
                linkInvocation: input.persistence.linkAgentInvocation({
                  taskId,
                  reviewId,
                  configuration: agentConfiguration(resolvedPolicy.policy.profile),
                  configurationSnapshot: resolvedPolicy.policy.snapshot,
                }),
                reviewerRuntime: input.reviewerRuntime,
                reviewerExecutor: input.reviewerExecutor,
                decodeOutput,
                systemPrompt,
                prompt,
                continuationPrompt: buildTaskReviewContinuationPrompt({
                  previousProposal: previous?.proposal,
                  currentPrompt: prompt,
                  currentProposal: admitted.proposal,
                }),
                commandCwd: active.worktreePath,
                resourceRoot: active.worktreePath,
                profile: resolvedPolicy.policy.profile,
                reviewer: "task",
                sessionStorageRoot: input.agentSessionStorageRoot,
                ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
                settleDomain: ({ result }) =>
                  Effect.gen(function* () {
                    const evidence = yield* Effect.either(
                      settleTaskReviewEvidence(input, admitted.review, now),
                    );
                    const cleanupFailure =
                      evidence._tag === "Left"
                        ? {
                            operation: "settle_task_review_evidence",
                            message: taskReviewStorageErrorMessage(evidence.left),
                          }
                        : evidence.right.ok
                          ? undefined
                          : {
                              operation: "settle_task_review_evidence",
                              message: evidence.right.message,
                            };
                    const toolingFailure =
                      cleanupFailure ??
                      (result.ok
                        ? undefined
                        : {
                            operation: result.failure.operationName,
                            message: result.failure.message,
                          });
                    return input.persistence.settleAgentReview({
                      reviewId,
                      findings: result.ok ? result.report.findings : [],
                      ...(toolingFailure === undefined ? {} : { toolingFailure }),
                      now,
                      complete: toolingFailure === undefined,
                    });
                  }),
              });
              const reviewed = execution.result;
              const sessionReference = reviewed.sessionReference ?? null;
              return reviewed.ok
                ? ({
                    ok: true,
                    output: reviewed.report,
                    sessionReference,
                  } as const)
                : ({
                    ok: false,
                    failure: {
                      operation: reviewed.failure.operationName,
                      message: reviewed.failure.message,
                    },
                    sessionReference,
                  } as const);
            }),
        });
        const execution: WorkspaceExecution =
          workspace.ok && workspace.workspaceResult !== undefined
            ? workspace.workspaceResult
            : {
                ok: false,
                failure: workspace.ok
                  ? { operation: "run_task_review", message: "Task reviewer produced no result." }
                  : {
                      operation: workspace.toolingError.operationName,
                      message: workspace.toolingError.errorMessage,
                    },
              };
        const settlement = yield* settleTaskReviewEvidence(input, admitted.review, now);
        if (!settlement.ok) {
          return {
            ok: false,
            code: "task_review_recovery_required",
            review: settlement.review,
          } as const;
        }

        const completed = yield* input.persistence.complete({
          reviewId,
          findings: execution.ok ? execution.output.findings : (execution.findings ?? []),
          ...(execution.ok ? {} : { toolingFailure: execution.failure }),
          now,
          agentSettlement: true,
        });
        if (!completed.ok) {
          const active = yield* input.persistence.getById(reviewId);
          if (active === undefined) return { ok: false, code: "task_review_not_found" } as never;
          return { ok: false, code: "task_review_recovery_required", review: active } as const;
        }
        return completed;
      }),
      outcome: (result) => (result.ok && result.outcome === "passed" ? "passed" : "failed"),
    });
    return result;
  });

const taskReviewPolicyFromSnapshot = (
  snapshot: TaskReviewPolicySnapshot,
): TaskReviewPolicyResolutionResult =>
  snapshot.profile.profile === null
    ? { ok: false, message: "Stored Task Reviewer configuration has no Agent Profile." }
    : {
        ok: true,
        policy: {
          snapshot,
          profile: {
            agentProfile: snapshot.profile.agentProfile,
            scope: snapshot.profile.scope,
            profile: snapshot.profile.profile,
          },
        },
      };

const agentConfiguration = (profile: ResolvedPiAgentProfile): AgentSessionConfiguration => ({
  harness: "pi",
  provider: null,
  model: profile.profile.runtimeConfig?.model ?? "",
  thinking: profile.profile.runtimeConfig?.thinking ?? null,
});

const taskReviewProgressProfile = (profile: ResolvedPiAgentProfile): SubmitProgressProfile => ({
  name: profile.agentProfile,
  model: profile.profile.runtimeConfig?.model ?? "unknown",
  thinking: profile.profile.runtimeConfig?.thinking ?? "default",
});

const taskReviewStorageErrorMessage = (error: RepositoryStorageError): string =>
  "operationName" in error
    ? `Task Review persistence failed during ${error.operationName}.`
    : `Task Review persistence failed: ${error._tag}.`;

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
      taskReviewWorkspaceId(review.id),
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
  reviewId: number,
  reason: string,
  now: string,
): Effect.Effect<TaskReviewAbandonResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const review = yield* input.persistence.getById(reviewId);
    if (review === undefined) return { ok: false, code: "task_review_not_found" } as const;
    if (review.state !== "running") return { ok: false, code: "task_review_not_active" } as const;
    const settlement = yield* settleTaskReviewEvidence(input, review, now);
    if (!settlement.ok) {
      return {
        ok: false,
        code: "task_review_cleanup_failed",
        review: settlement.review,
        message: settlement.message,
      } as const;
    }
    const abandoned = yield* input.persistence.abandon(review.id, reason, now);
    return abandoned.ok
      ? {
          ok: true,
          outcome: "tooling_failed",
          review: abandoned.review,
          task: abandoned.task,
        }
      : abandoned;
  });

const buildTaskReviewContinuationPrompt = (input: {
  readonly previousProposal: TaskReviewRecord["proposal"] | undefined;
  readonly currentProposal: TaskReviewRecord["proposal"];
  readonly currentPrompt: string;
}): string =>
  [
    "Continue the compatible Task Agent Session with the complete current proposal below.",
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
