import { Effect } from "effect";
import {
  type AgentEnvironmentCommand,
  repoAgentEnvironment,
} from "../../agent/agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "../../agent/agentProfiles.js";
import type { AgentSessionConfiguration } from "../../agent/agentSession/agentSession.js";
import { executeAgentSession } from "../../agent/agentSession/executeAgentSession.js";
import {
  type ReviewerAgentResult,
  type ReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerProcessExecutor } from "../../agent/reviewerExecution.js";
import { parseTaggedReviewerTextOutput } from "../../agent/reviewerOutputWire.js";
import type { WorkspaceCommandExecutor } from "../../command/workspaceCommand.js";
import type { RepoConfig } from "../../contracts/repoConfig.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  type DisposableWorkspaceIntegrityFailed,
  type DisposableWorktreeInspection,
  type ExactDisposableWorkspaceCleanupInput,
  type ExactDisposableWorkspaceCleanupResult,
  type RestoreDisposableWorkspace,
  verifyDisposableWorkspaceIntegrity,
} from "../../disposableWorkspace/disposableWorkspace.js";
import type { RunDisposableExactCommitWorkspace } from "../../disposableWorkspace/runDisposableExactCommitWorkspace.js";
import { runRepositoryPreparationEffect } from "../../repositoryPreparation/runRepositoryPreparation.js";
import {
  buildTaskReviewerPrompt,
  buildTaskReviewerSystemPrompt,
} from "../../reviewerPrompts/taskReviewerPrompt.js";
import {
  buildTaskSimplificationAdviceOutputCorrectionPrompt,
  buildTaskSimplificationAdvicePrompt,
  buildTaskSimplificationAdviceSystemPrompt,
} from "../../reviewerPrompts/taskSimplificationAdvicePrompt.js";
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
import type {
  TaskReviewPolicyResolutionResult,
  TaskSimplificationAdvicePolicyResolutionResult,
} from "./taskReviewConfig.js";
import { settleTaskReviewEvidence } from "./taskReviewEvidenceSettlement.js";
import { decodeTaskReviewerOutput, type TaskReviewerOutput } from "./taskReviewerOutput.js";
import type {
  CompleteTaskReviewSuccess,
  TaskReviewAdmissionPersistence,
  TaskReviewPersistence,
} from "./taskReviewPersistence.js";
import { taskReviewWorkspaceId } from "./taskReviewWorkspace.js";
import type {
  TaskSimplificationAdvice,
  TaskSimplificationAdviceAttempt,
} from "./taskSimplificationAdvice.js";
import {
  decodeTaskSimplificationAdviceOutput,
  type TaskSimplificationAdviceOutput,
} from "./taskSimplificationAdviceOutput.js";

type TaskReviewSubmissionAdvice =
  | {
      readonly simplificationAdvice: TaskSimplificationAdvice;
      readonly simplificationAdviceAttempt?: never;
    }
  | {
      readonly simplificationAdvice?: never;
      readonly simplificationAdviceAttempt: TaskSimplificationAdviceAttempt;
    }
  | {
      readonly simplificationAdvice?: never;
      readonly simplificationAdviceAttempt?: never;
    };

export type TaskReviewSubmitResult =
  | (CompleteTaskReviewSuccess & TaskReviewSubmissionAdvice)
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: string }
  | { readonly ok: false; readonly code: "task_change_linked"; readonly changeId: string }
  | { readonly ok: false; readonly code: "active_task_review"; readonly reviewId: number }
  | { readonly ok: false; readonly code: "review_base_unavailable"; readonly message: string }
  | { readonly ok: false; readonly code: "task_review_config_invalid"; readonly message: string }
  | { readonly ok: false; readonly code: "task_review_not_found" }
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
  readonly repositoryRoot: string;
  readonly repositoryCommonDirectory: string;
  readonly loadRepoConfig: (
    commit: string,
  ) =>
    | { readonly ok: true; readonly config: RepoConfig }
    | { readonly ok: false; readonly message: string };
  readonly resolvePolicy: (
    repoConfig: RepoConfig,
    baseCommit: string,
  ) => TaskReviewPolicyResolutionResult;
  readonly resolveSimplificationAdvicePolicy: (
    repoConfig: RepoConfig,
    baseCommit: string,
  ) => TaskSimplificationAdvicePolicyResolutionResult;
  readonly persistence: TaskReviewPersistence;
  readonly admission?: TaskReviewAdmissionPersistence;
  readonly agentSessionStorageRoot: string;
  readonly reviewerRuntime: ReviewerAgentRuntime<TaskReviewerOutput>;
  readonly underengineerRuntime: ReviewerAgentRuntime<TaskSimplificationAdviceOutput>;
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly readReviewBase: (
    repositoryRoot: string,
  ) => Effect.Effect<
    | { readonly ok: true; readonly base: TaskReviewBase }
    | { readonly ok: false; readonly message: string }
  >;
  readonly verifyReviewBase: (
    repositoryRoot: string,
    recorded: TaskReviewBase,
  ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly runWorkspace: RunDisposableExactCommitWorkspace;
  readonly restoreWorkspace: RestoreDisposableWorkspace;
  readonly cleanupWorkspace: (
    repositoryRoot: string,
    repositoryCommonDirectory: string,
    cleanup: ExactDisposableWorkspaceCleanupInput,
  ) => Effect.Effect<ExactDisposableWorkspaceCleanupResult>;
  readonly inspectWorkspace: (
    repositoryRoot: string,
    repositoryCommonDirectory: string,
    workspaceId: string,
    expectedCommitSha: string,
  ) => Effect.Effect<DisposableWorktreeInspection>;
  readonly progress?: SubmitProgress;
}): TaskReviewUseCases => ({
  submit: (taskId, now) => submitTaskReview(input, taskId, now),
  abandon: (reviewId, reason, now) => abandonTaskReview(input, reviewId, reason, now),
  getById: input.persistence.getById,
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

    const base = yield* input.readReviewBase(input.repositoryRoot);
    if (!base.ok)
      return { ok: false, code: "review_base_unavailable", message: base.message } as const;
    const config = input.loadRepoConfig(base.base.commit);
    if (!config.ok)
      return { ok: false, code: "review_base_unavailable", message: config.message } as const;
    const repoConfig = config.config;
    const storedPolicy = yield* input.persistence.getReviewerConfiguration(taskId);
    const resolvedPolicy =
      storedPolicy === undefined
        ? input.resolvePolicy(repoConfig, base.base.commit)
        : taskReviewPolicyFromSnapshot(storedPolicy);
    if (!resolvedPolicy.ok) {
      return {
        ok: false,
        code: "task_review_config_invalid",
        message: resolvedPolicy.message,
      } as const;
    }
    const completedAdviceBeforeAdmission =
      yield* input.persistence.getCompletedSimplificationAdvice(taskId);
    const advicePolicy =
      completedAdviceBeforeAdmission === undefined
        ? input.resolveSimplificationAdvicePolicy(repoConfig, base.base.commit)
        : undefined;
    const admitted = yield* admission.admit({
      taskId,
      policy: resolvedPolicy.policy.snapshot,
      baseRef: base.base.ref,
      baseCommit: base.base.commit,
      now,
      ...(completedAdviceBeforeAdmission === undefined
        ? {
            simplificationAdvice: {
              ...(advicePolicy?.ok === true ? { configuration: advicePolicy.policy } : {}),
            },
          }
        : {}),
    });
    if (!admitted.ok) return admitted;
    const reviewId = admitted.review.id;
    const ownsSimplificationAdviceAttempt =
      admitted.review.simplificationAdviceAttempt !== undefined;
    const completedAdvice = ownsSimplificationAdviceAttempt
      ? undefined
      : yield* input.persistence.getCompletedSimplificationAdvice(taskId);

    let taskReviewProgress: StartedSubmitProgress | undefined;
    const result = yield* runAfterSubmitProgressStarted({
      progress: input.progress,
      started: () => taskReviewProgress,
      run: Effect.gen(function* () {
        const workspace = yield* input.runWorkspace<WorkspaceExecution, RepositoryStorageError>({
          repositoryRoot: input.repositoryRoot,
          repositoryCommonDirectory: input.repositoryCommonDirectory,
          workspaceId: taskReviewWorkspaceId(reviewId),
          commitSha: base.base.commit,
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
                const integrity = yield* Effect.either(
                  verifyDisposableWorkspaceIntegrity({
                    commandExecutor: active.commandExecutor,
                    commandCwd: active.worktreePath,
                    expectedCommitSha: base.base.commit,
                    allowedUntrackedFiles: [],
                  }),
                );
                if (integrity._tag === "Left") {
                  return {
                    ok: false,
                    failure: taskReviewIntegrityFailure(integrity.left),
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
              if (ownsSimplificationAdviceAttempt) {
                const adviceResult = yield* runTaskSimplificationAdvice({
                  input,
                  reviewId,
                  policy:
                    advicePolicy ??
                    ({
                      ok: false,
                      message: "Task Simplification Advice policy is unavailable.",
                    } as const),
                  admitted,
                  base: base.base,
                  active,
                  ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
                });
                if (!adviceResult.ok) {
                  return {
                    ok: false,
                    failure: adviceResult.failure,
                  } as const;
                }
              }
              const systemPrompt = buildTaskReviewerSystemPrompt(resolvedPolicy.policy.snapshot);
              const prompt = buildTaskReviewerPrompt({
                proposal: admitted.proposal,
                dependencyEvidence: admitted.dependencyEvidence,
              });
              taskReviewProgress = yield* startSubmitProgress(input.progress, {
                kind: "taskReview",
                profile: reviewerProgressProfile(resolvedPolicy.policy.profile),
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
                journal: input.persistence.agentSessionJournal,
                dispatchEntry: {
                  kind: "task_review_dispatch",
                  taskId,
                  reviewId,
                  admittedPolicy: admitted.policy,
                },
                reviewerRuntime: input.reviewerRuntime,
                reviewerExecutor: input.reviewerExecutor,
                decodeOutput,
                systemPrompt,
                prompt,
                continuationPrompt: buildTaskReviewContinuationPrompt(prompt),
                commandCwd: active.worktreePath,
                resourceRoot: active.worktreePath,
                profile: resolvedPolicy.policy.profile,
                reviewer: "task",
                sessionStorageRoot: input.agentSessionStorageRoot,
                ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
                afterInvocation: ({ result }) =>
                  restoreTaskReviewWorkspaceAfterInvocation({
                    result,
                    restoreWorkspace: input.restoreWorkspace,
                    commandExecutor: active.commandExecutor,
                    commandCwd: active.worktreePath,
                    expectedCommitSha: base.base.commit,
                    repositoryRoot: input.repositoryRoot,
                    repositoryCommonDirectory: input.repositoryCommonDirectory,
                    workspaceId: taskReviewWorkspaceId(reviewId),
                  }),
                settlementEntry: ({ result }) =>
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
                    return {
                      kind: "task_review_settlement" as const,
                      reviewId,
                      findings: result.ok ? result.report.findings : [],
                      ...(toolingFailure === undefined ? {} : { toolingFailure }),
                      now,
                      complete: toolingFailure === undefined,
                    };
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
        const workspaceFailure = workspace.ok
          ? workspace.workspaceResult?.ok === false
            ? workspace.workspaceResult.failure
            : undefined
          : {
              operation: workspace.toolingError.operationName,
              message: workspace.toolingError.errorMessage,
            };
        if (workspaceFailure !== undefined && ownsSimplificationAdviceAttempt) {
          yield* input.persistence.recordSimplificationAdviceFailure(reviewId, workspaceFailure);
        }
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
        });
        if (!completed.ok) {
          const active = yield* input.persistence.getById(reviewId);
          if (active === undefined) return { ok: false, code: "task_review_not_found" } as const;
          return { ok: false, code: "task_review_recovery_required", review: active } as const;
        }
        const advice =
          completedAdvice ?? (yield* input.persistence.getCompletedSimplificationAdvice(taskId));
        return {
          ...completed,
          ...(advice !== undefined ? { simplificationAdvice: advice } : {}),
          ...(advice === undefined && completed.review.simplificationAdviceAttempt !== undefined
            ? { simplificationAdviceAttempt: completed.review.simplificationAdviceAttempt }
            : {}),
        };
      }),
      outcome: (result) => (result.ok && result.outcome === "passed" ? "passed" : "failed"),
    });
    return result;
  });

const runTaskSimplificationAdvice = (input: {
  readonly input: Parameters<typeof openTaskReviewUseCases>[0];
  readonly reviewId: number;
  readonly policy: TaskSimplificationAdvicePolicyResolutionResult;
  readonly admitted: {
    readonly proposal: TaskReviewRecord["proposal"];
    readonly dependencyEvidence: TaskReviewRecord["dependencyEvidence"];
  };
  readonly base: TaskReviewBase;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly active: {
    readonly worktreePath: string;
    readonly commandExecutor: WorkspaceCommandExecutor;
  };
}): Effect.Effect<
  { readonly ok: true } | { readonly ok: false; readonly failure: TaskReviewToolingFailure },
  RepositoryStorageError
> =>
  Effect.gen(function* () {
    const persistence = input.input.persistence;
    if (!input.policy.ok) {
      const failure = {
        operation: "resolve_underengineer_configuration",
        message: input.policy.message,
      } as const;
      yield* persistence.recordSimplificationAdviceFailure(input.reviewId, failure);
      return { ok: true } as const;
    }
    const profile = input.policy.policy.profile;
    const decodeOutput = (output: unknown, attempts: number) =>
      decodeTaskSimplificationAdviceOutput({ attempts, output }).pipe(
        Effect.mapError(
          (error) =>
            new ReviewerExecutionFailed({
              kind: "output_contract",
              operationName: error.operationName,
              message: error.message,
              correctionPrompt: buildTaskSimplificationAdviceOutputCorrectionPrompt(error),
            }),
        ),
      );
    const execution = yield* runWithSubmitProgress({
      progress: input.input.progress,
      phase: {
        kind: "underengineer",
        profile: reviewerProgressProfile(profile),
      },
      run: executeAgentSession({
        configuration: agentConfiguration(profile),
        journal: persistence.agentSessionJournal,
        dispatchEntry: {
          kind: "simplification_advice_dispatch" as const,
          reviewId: input.reviewId,
        },
        reviewerRuntime: input.input.underengineerRuntime,
        reviewerExecutor: input.input.reviewerExecutor,
        decodeOutput,
        parseOutput: parseTaggedReviewerTextOutput,
        systemPrompt: buildTaskSimplificationAdviceSystemPrompt(
          input.policy.policy.builtInInstructions,
        ),
        prompt: buildTaskSimplificationAdvicePrompt({
          proposal: input.admitted.proposal,
          dependencyEvidence: input.admitted.dependencyEvidence,
          reviewBase: input.base,
        }),
        continuationPrompt: "",
        commandCwd: input.active.worktreePath,
        resourceRoot: input.active.worktreePath,
        profile,
        reviewer: "underengineer",
        sessionStorageRoot: input.input.agentSessionStorageRoot,
        ...(input.agentEnvironment === undefined
          ? {}
          : { agentEnvironment: input.agentEnvironment }),
        afterInvocation: ({ result }) =>
          restoreTaskReviewWorkspaceAfterInvocation({
            result,
            restoreWorkspace: input.input.restoreWorkspace,
            commandExecutor: input.active.commandExecutor,
            commandCwd: input.active.worktreePath,
            expectedCommitSha: input.base.commit,
            repositoryRoot: input.input.repositoryRoot,
            repositoryCommonDirectory: input.input.repositoryCommonDirectory,
            workspaceId: taskReviewWorkspaceId(input.reviewId),
          }),
        settlementEntry: ({ result }) =>
          Effect.succeed({
            kind: "simplification_advice_settlement" as const,
            reviewId: input.reviewId,
            ...(result.ok
              ? { advice: result.report, complete: true as const }
              : {
                  complete: false as const,
                  failure: {
                    operation: result.failure.operationName,
                    message: result.failure.message,
                  },
                }),
          }),
      }),
      outcome: (result) => (result.result.ok ? "passed" : "failed"),
    });
    if (
      !execution.result.ok &&
      execution.result.failure.operationName === "verify_task_review_workspace"
    ) {
      return {
        ok: false,
        failure: {
          operation: "verify_task_review_workspace",
          message: execution.result.failure.message,
        },
      } as const;
    }
    return { ok: true } as const;
  });

const taskReviewIntegrityFailure = (
  failure: DisposableWorkspaceIntegrityFailed | { readonly message: string },
): TaskReviewToolingFailure => ({
  operation: "verify_task_review_workspace",
  message: failure.message,
});

const restoreTaskReviewWorkspaceAfterInvocation = <Output>(input: {
  readonly result: ReviewerAgentResult<Output>;
  readonly restoreWorkspace: RestoreDisposableWorkspace;
  readonly commandExecutor: WorkspaceCommandExecutor;
  readonly commandCwd: string;
  readonly expectedCommitSha: string;
  readonly repositoryRoot: string;
  readonly repositoryCommonDirectory: string;
  readonly workspaceId: string;
}): Effect.Effect<ReviewerAgentResult<Output>> =>
  Effect.gen(function* () {
    const restored = yield* Effect.either(
      Effect.uninterruptible(
        input.restoreWorkspace({
          commandExecutor: input.commandExecutor,
          commandCwd: input.commandCwd,
          expectedCommitSha: input.expectedCommitSha,
          workspaceIdentity: {
            repositoryRoot: input.repositoryRoot,
            repositoryCommonDirectory: input.repositoryCommonDirectory,
            workspaceId: input.workspaceId,
          },
        }),
      ),
    );
    if (restored._tag === "Right") return input.result;
    return {
      ok: false as const,
      failure: {
        kind: "process_execution" as const,
        operationName: "verify_task_review_workspace",
        message: restored.left.message,
        sessionUsability: "unknown" as const,
        ...(input.result.sessionReference === undefined
          ? {}
          : { sessionReference: input.result.sessionReference }),
        ...(input.result.sessionFilePath === undefined
          ? {}
          : { sessionFilePath: input.result.sessionFilePath }),
      },
      sessionUsability: "unknown" as const,
      attempts: input.result.attempts,
      stdout: input.result.stdout,
      ...(input.result.invocationUsage === undefined
        ? {}
        : { invocationUsage: input.result.invocationUsage }),
      ...(input.result.sessionReference === undefined
        ? {}
        : { sessionReference: input.result.sessionReference }),
      ...(input.result.sessionFilePath === undefined
        ? {}
        : { sessionFilePath: input.result.sessionFilePath }),
    } satisfies ReviewerAgentResult<Output>;
  });

const taskReviewPolicyFromSnapshot = (
  snapshot: TaskReviewPolicySnapshot,
): TaskReviewPolicyResolutionResult => ({
  ok: true,
  policy: { snapshot, profile: snapshot.profile },
});

const agentConfiguration = (profile: ResolvedPiAgentProfile): AgentSessionConfiguration => ({
  harness: "pi",
  provider: null,
  model: profile.profile.runtimeConfig?.model ?? "",
  thinking: profile.profile.runtimeConfig?.thinking ?? null,
});

const reviewerProgressProfile = (profile: ResolvedPiAgentProfile): SubmitProgressProfile => ({
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
    readonly repositoryRoot: string;
    readonly repositoryCommonDirectory: string;
    readonly verifyReviewBase: (
      repositoryRoot: string,
      recorded: TaskReviewBase,
    ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
    readonly inspectWorkspace: (
      repositoryRoot: string,
      repositoryCommonDirectory: string,
      workspaceId: string,
      expectedCommitSha: string,
    ) => Effect.Effect<DisposableWorktreeInspection>;
  },
  review: TaskReviewRecord,
): Effect.Effect<TaskReviewIdentityInspection> =>
  Effect.gen(function* () {
    const base = yield* input.verifyReviewBase(input.repositoryRoot, {
      ref: review.baseRef,
      commit: review.baseCommit,
    });
    if (!base.ok) return { verified: false, message: base.message } as const;
    const workspace = yield* input.inspectWorkspace(
      input.repositoryRoot,
      input.repositoryCommonDirectory,
      taskReviewWorkspaceId(review.id),
      review.baseCommit,
    );
    return workspace.state === "unproven"
      ? ({ verified: false, message: workspace.message } as const)
      : ({ verified: true, workspace } as const);
  });

export const abandonTaskReview = (
  input: {
    readonly repositoryRoot: string;
    readonly repositoryCommonDirectory: string;
    readonly persistence: TaskReviewPersistence;
    readonly verifyReviewBase: (
      repositoryRoot: string,
      recorded: TaskReviewBase,
    ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
    readonly cleanupWorkspace: (
      repositoryRoot: string,
      repositoryCommonDirectory: string,
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

const buildTaskReviewContinuationPrompt = (currentPrompt: string): string =>
  [
    "Continue the compatible Task Agent Session with the complete current proposal below.",
    currentPrompt,
  ].join("\n\n");
