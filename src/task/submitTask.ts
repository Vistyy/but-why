import { randomUUID } from "node:crypto";
import type { Sandbox } from "@ai-hero/sandcastle";
import { Effect, Either } from "effect";

import { repoAgentEnvironment } from "../agent/agentEnvironment.js";
import type { ReviewerAgentRuntime } from "../agent/reviewerAgentRuntime.js";
import { parseTaggedReviewerOutput } from "../agent/reviewerOutputWire.js";
import type { SubmitPrepareConfig } from "../change/submit/submitRepoConfig.js";
import type { ExecutionLock } from "../contracts/executionLock.js";
import type { GlobalConfig } from "../contracts/globalConfig.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { runRepositoryPreparation } from "../repositoryPreparation/runRepositoryPreparation.js";
import { disposableWorktreePath } from "../workspace/workspaceGit.js";
import type { TaskState } from "./lifecycle.js";
import type { PublicTaskId } from "./taskId.js";
import type {
  TaskReviewFinding,
  TaskReviewProposal,
  TaskReviewToolingFailure,
} from "./taskReview.js";
import {
  decodeTaskReviewReviewerOutput,
  decodeTaskReviewRuntimeOutput,
  resolveTaskReviewPolicy,
  reviewerOutputToFindings,
  type TaskReviewPolicy,
  taskReviewPolicySnapshot,
} from "./taskReviewPolicy.js";
import { buildTaskReviewerPrompt } from "./taskReviewPrompts.js";
import type {
  StartTaskReviewResult,
  TaskReviewCompletionFailure,
  TaskReviewPersistence,
  TaskReviewTaskFact,
} from "./taskReviewStore.js";
import type { TaskReviewToolingFailureRecord } from "./taskReviewTooling.js";
import { taskReviewToolingFailureRecord } from "./taskReviewTooling.js";
import { createTaskReviewWorkspace, taskReviewTempRefName } from "./taskReviewWorkspace.js";

export type MainCheckoutHeadResult =
  | { readonly ok: true; readonly commit: string }
  | { readonly ok: false };

export type RepoConfigAtCommitResult =
  | { readonly ok: true; readonly config: RepoConfig }
  | { readonly ok: false; readonly message: string };

export type TaskGlobalConfigReadResult =
  | { readonly ok: true; readonly config: GlobalConfig }
  | { readonly ok: false; readonly message: string };

export type TaskSubmissionDependencies = {
  readonly persistence: TaskReviewPersistence;
  readonly executionLock: ExecutionLock;
  readonly mainCheckoutRoot: string;
  readonly globalConfigPath: string;
  readonly readMainCheckoutHead: (cwd: string) => MainCheckoutHeadResult;
  readonly readRepoConfigAtCommit: (cwd: string, commit: string) => RepoConfigAtCommitResult;
  readonly readGlobalConfig: (globalConfigPath: string) => TaskGlobalConfigReadResult;
  readonly reviewerAgentRuntime: ReviewerAgentRuntime;
};

export type TaskSubmitResult =
  | {
      readonly ok: true;
      readonly status: "passed" | "blocked";
      readonly reviewId: string;
      readonly baseCommit: string;
      readonly task: TaskReviewTaskFact;
      readonly findings?: readonly Omit<TaskReviewFinding, "createdAt">[];
    }
  | {
      readonly ok: true;
      readonly status: "tooling_failed";
      readonly reviewId: string;
      readonly task: TaskReviewTaskFact;
      readonly toolingFailures: readonly TaskReviewToolingFailure[];
    }
  | { readonly ok: false; readonly code: "task_not_found" }
  | { readonly ok: false; readonly code: "invalid_task_state"; readonly state: TaskState }
  | { readonly ok: false; readonly code: "task_linked_to_change" }
  | { readonly ok: false; readonly code: "review_active"; readonly reviewId: string }
  | {
      readonly ok: false;
      readonly code: "review_cleanup_pending";
      readonly reviewId: string;
      readonly completionFailure: TaskReviewCompletionFailure;
    }
  | { readonly ok: false; readonly code: "main_checkout_unavailable" }
  | { readonly ok: false; readonly code: "validation_policy_invalid"; readonly message: string }
  | { readonly ok: false; readonly code: "submission_in_progress" };

export type TaskSubmission = {
  readonly submit: (input: {
    readonly taskId: PublicTaskId;
    readonly now: string;
  }) => Effect.Effect<TaskSubmitResult, RepositoryStorageError>;
};

export const openTaskSubmission = (dependencies: TaskSubmissionDependencies): TaskSubmission => ({
  submit: (input) => {
    const operation = submitTask(dependencies, input);
    return dependencies.executionLock
      .withLock({
        owner: "task_submission",
        key: input.taskId,
        effect: operation,
      })
      .pipe(
        Effect.catchTag("ExecutionLockUnavailable", () =>
          Effect.succeed({ ok: false as const, code: "submission_in_progress" as const }),
        ),
      );
  },
});

const submitTask = (
  dependencies: TaskSubmissionDependencies,
  input: { readonly taskId: PublicTaskId; readonly now: string },
): Effect.Effect<TaskSubmitResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const head = dependencies.readMainCheckoutHead(dependencies.mainCheckoutRoot);
    if (!head.ok) return { ok: false as const, code: "main_checkout_unavailable" as const };

    const repoConfig = dependencies.readRepoConfigAtCommit(
      dependencies.mainCheckoutRoot,
      head.commit,
    );
    if (!repoConfig.ok) {
      return {
        ok: false as const,
        code: "validation_policy_invalid" as const,
        message: repoConfig.message,
      };
    }
    const global = dependencies.readGlobalConfig(dependencies.globalConfigPath);
    if (!global.ok) {
      return {
        ok: false as const,
        code: "validation_policy_invalid" as const,
        message: global.message,
      };
    }
    const policy = resolveTaskReviewPolicy({
      repoConfig: repoConfig.config,
      globalConfig: global.config,
      repoRoot: dependencies.mainCheckoutRoot,
      globalConfigPath: dependencies.globalConfigPath,
    });
    if (!policy.ok) {
      return {
        ok: false as const,
        code: "validation_policy_invalid" as const,
        message: policyResolutionMessage(policy.error),
      };
    }

    const reviewId = randomUUID();
    const tempRefName = taskReviewTempRefName(reviewId);
    const started = yield* dependencies.persistence.start({
      taskId: input.taskId,
      baseCommit: head.commit,
      policy: taskReviewPolicySnapshot(policy.policy),
      reviewId,
      workspaceSetup: {
        tempRefName,
        worktreePath: disposableWorktreePath(dependencies.mainCheckoutRoot, tempRefName),
      },
      now: input.now,
    });
    if (!started.ok) return startedError(started);

    const copyFiles: readonly string[] = [];
    const prepare = taskReviewPrepareConfig(repoConfig.config.prepare);
    const agentEnvironment = repoAgentEnvironment(repoConfig.config);
    const workspace = yield* createTaskReviewWorkspace<
      TaskReviewPhaseResult,
      RepositoryStorageError
    >({
      repoRoot: dependencies.mainCheckoutRoot,
      reviewId,
      submittedSha: head.commit,
      copyFiles,
      recordWorkspaceSetup: (setup) =>
        dependencies.persistence.recordWorkspaceSetup({ ...setup, createdAt: input.now }),
      recordInterruptedCleanupResult: (toolingError) =>
        dependencies.persistence.recordCompletionFailure({
          reviewId,
          operationName: toolingError.operationName,
          errorMessage: toolingError.errorMessage,
          now: input.now,
        }),
      runInWorkspace: (activeWorkspace) =>
        runTaskReviewPhases({
          reviewId,
          taskId: input.taskId,
          proposal: started.proposal,
          baseCommit: head.commit,
          policy: policy.policy,
          ...(prepare === undefined ? {} : { prepare }),
          reviewerAgentRuntime: dependencies.reviewerAgentRuntime,
          sandbox: activeWorkspace.sandbox,
          commandCwd: activeWorkspace.worktreePath,
          resourceRoot: activeWorkspace.worktreePath,
          ...(agentEnvironment === undefined ? {} : { agentEnvironment }),
          now: input.now,
        }),
    });

    // Persist the final workspace cleanup result captured after scoped cleanup
    // on every terminal path, replacing the provisional not_created admission
    // record so recovery always carries the exact cleanup outcome.
    yield* dependencies.persistence.recordWorkspaceSetup(
      workspace.ok
        ? { ...workspace.setup, createdAt: input.now }
        : {
            reviewId,
            tempRefName: workspace.toolingError.tempRefName,
            submittedSha: workspace.toolingError.submittedSha,
            worktreeHead: workspace.toolingError.submittedSha,
            ...(workspace.toolingError.worktreePath === undefined
              ? {}
              : { worktreePath: workspace.toolingError.worktreePath }),
            cleanupWorktree: workspace.toolingError.cleanupResult.worktree,
            cleanupTempRef: workspace.toolingError.cleanupResult.tempRef,
            createdAt: input.now,
          },
    );

    if (!workspace.ok) {
      const toolingError = workspace.toolingError;
      if (toolingError.operationName === "cleanup_disposable_workspace") {
        yield* dependencies.persistence.recordCompletionFailure({
          reviewId,
          operationName: toolingError.operationName,
          errorMessage: toolingError.errorMessage,
          now: input.now,
        });
        const completionFailure = yield* dependencies.persistence.getCompletionFailure(reviewId);
        return {
          ok: false as const,
          code: "review_cleanup_pending" as const,
          reviewId,
          completionFailure: completionFailure ?? {
            reviewId,
            operationName: toolingError.operationName,
            errorMessage: toolingError.errorMessage,
            createdAt: input.now,
          },
        };
      }
      const failure = taskReviewToolingFailureRecord({
        errorKind: "task_review_workspace_setup_failed",
        operationName: toolingError.operationName,
        errorMessage: toolingError.errorMessage,
      });
      const completed = yield* dependencies.persistence.complete({
        reviewId,
        outcome: "tooling_failed",
        toolingFailure: failure,
        now: input.now,
      });
      if (!completed.ok) {
        return { ok: false as const, code: "submission_in_progress" as const };
      }
      return yield* toolingFailedResult(dependencies.persistence, reviewId, input.taskId);
    }

    const phase = workspace.activeWorkspaceResult;
    if (phase !== undefined && phase.toolingFailure !== undefined) {
      const completed = yield* dependencies.persistence.complete({
        reviewId,
        outcome: "tooling_failed",
        toolingFailure: phase.toolingFailure,
        now: input.now,
      });
      if (!completed.ok) {
        return { ok: false as const, code: "submission_in_progress" as const };
      }
      return yield* toolingFailedResult(dependencies.persistence, reviewId, input.taskId);
    }

    const findings = phase?.findings ?? [];
    const outcome = phase?.outcome ?? "blocked";
    const completed = yield* dependencies.persistence.complete({
      reviewId,
      outcome,
      findings,
      now: input.now,
    });
    if (!completed.ok) {
      return { ok: false as const, code: "submission_in_progress" as const };
    }
    return {
      ok: true as const,
      status: outcome,
      reviewId,
      baseCommit: head.commit,
      task: completed.task,
      ...(findings.length === 0 ? {} : { findings }),
    };
  });

const startedError = (
  started: Extract<StartTaskReviewResult, { readonly ok: false }>,
): TaskSubmitResult => {
  switch (started.code) {
    case "task_not_found":
      return { ok: false as const, code: "task_not_found" as const };
    case "invalid_task_state":
      return { ok: false as const, code: "invalid_task_state" as const, state: started.state };
    case "task_linked_to_change":
      return { ok: false as const, code: "task_linked_to_change" as const };
    case "review_active":
      return { ok: false as const, code: "review_active" as const, reviewId: started.reviewId };
  }
};

const toolingFailedResult = (
  persistence: TaskReviewPersistence,
  reviewId: string,
  taskId: PublicTaskId,
): Effect.Effect<TaskSubmitResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const task = yield* persistence.getTaskFact(taskId);
    return {
      ok: true as const,
      status: "tooling_failed" as const,
      reviewId,
      task: task ?? { id: taskId, state: "new" },
      toolingFailures: yield* persistence.listToolingFailures(reviewId),
    };
  });

const defaultTaskReviewPrepareTimeoutSeconds = 1200;

const taskReviewPrepareConfig = (
  prepare: RepoConfig["prepare"],
): SubmitPrepareConfig | undefined =>
  prepare === undefined
    ? undefined
    : {
        command: prepare.command,
        timeoutSeconds: prepare.timeoutSeconds ?? defaultTaskReviewPrepareTimeoutSeconds,
      };

type TaskReviewPhaseResult = {
  readonly outcome: "passed" | "blocked";
  readonly findings: readonly Omit<TaskReviewFinding, "createdAt">[];
  readonly toolingFailure?: TaskReviewToolingFailureRecord;
};

const runTaskReviewPhases = (input: {
  readonly reviewId: string;
  readonly taskId: PublicTaskId;
  readonly proposal: TaskReviewProposal;
  readonly baseCommit: string;
  readonly policy: TaskReviewPolicy;
  readonly prepare?: SubmitPrepareConfig;
  readonly reviewerAgentRuntime: ReviewerAgentRuntime;
  readonly sandbox: Pick<Sandbox, "exec" | "run">;
  readonly commandCwd: string;
  readonly resourceRoot?: string;
  readonly agentEnvironment?: readonly string[];
  readonly now: string;
}): Effect.Effect<TaskReviewPhaseResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    if (input.prepare !== undefined) {
      const prepareConfig = input.prepare;
      const prepareAttempt = yield* Effect.tryPromise({
        try: () =>
          runRepositoryPreparation({
            prepare: prepareConfig,
            exec: (command, options) => input.sandbox.exec(command, options),
            cwd: input.commandCwd,
          }),
        catch: (error) =>
          taskReviewToolingFailureRecord({
            errorKind: "prepare_command_execution_tooling_failed",
            operationName: "run_task_review_prepare",
            errorMessage: errorMessage(error),
          }),
      }).pipe(Effect.either);
      if (Either.isLeft(prepareAttempt)) {
        return {
          outcome: "blocked" as const,
          findings: [],
          toolingFailure: prepareAttempt.left,
        };
      }
      const prepare = prepareAttempt.right;
      if (prepare.exitCode !== 0) {
        return {
          outcome: "blocked" as const,
          findings: [],
          toolingFailure: taskReviewToolingFailureRecord({
            errorKind: "prepare_command_execution_tooling_failed",
            operationName: "run_task_review_prepare",
            errorMessage: `Prepare command exited with code ${prepare.exitCode}. Command: ${prepareConfig.command}.`,
          }),
        };
      }
    }

    const result = yield* input.reviewerAgentRuntime.review({
      sandbox: input.sandbox,
      reviewer: "task_review",
      validationRunId: input.reviewId,
      availableArtifactRefs: [],
      decodeOutput: decodeTaskReviewRuntimeOutput,
      prompt: buildTaskReviewerPrompt({
        reviewId: input.reviewId,
        baseCommit: input.baseCommit,
        proposal: input.proposal,
        policy: input.policy,
      }),
      profile: input.policy.profile,
      commandCwd: input.commandCwd,
      ...(input.resourceRoot === undefined ? {} : { resourceRoot: input.resourceRoot }),
      ...(input.agentEnvironment === undefined ? {} : { agentEnvironment: input.agentEnvironment }),
    });
    if (!result.ok) {
      return {
        outcome: "blocked" as const,
        findings: [],
        toolingFailure: taskReviewToolingFailureRecord({
          errorKind: "infrastructure_tooling_failed",
          operationName: "run_task_reviewer_agent",
          errorMessage: result.failure.message,
        }),
      };
    }
    const decodedAttempt = yield* decodeTaskReviewReviewerOutput({
      reviewer: "task_review",
      attempts: result.attempts,
      output:
        result.outputContract === "injected"
          ? result.report
          : parseTaggedReviewerOutput(result.stdout),
    }).pipe(
      Effect.mapError(
        (error): TaskReviewToolingFailureRecord =>
          taskReviewToolingFailureRecord({
            errorKind: "reviewer_output_contract_failed",
            operationName: "decode_task_review_output",
            errorMessage: errorMessage(error),
          }),
      ),
      Effect.either,
    );
    if (Either.isLeft(decodedAttempt)) {
      return {
        outcome: "blocked" as const,
        findings: [],
        toolingFailure: decodedAttempt.left,
      };
    }
    const decoded = decodedAttempt.right;
    const findings = reviewerOutputToFindings(input.reviewId, decoded);
    return {
      outcome: findings.length === 0 ? "passed" : "blocked",
      findings,
    };
  });

const policyResolutionMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return "Task Reviewer policy could not be resolved.";
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
