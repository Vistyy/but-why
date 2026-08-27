import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";
import { piReviewerProcessExecutor } from "../../agent/adapters/piReviewerProcessExecutor.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../agent/reviewerAgentRuntime.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  cleanupExactDisposableWorkspace,
  inspectDisposableWorktree,
  restoreDisposableWorkspace,
} from "../../disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { runDisposableExactCommitWorkspace } from "../../disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import { readGlobalConfig } from "../../init/adapters/globalConfig.js";
import { decodeRepoConfigSource } from "../../init/adapters/repoConfig.js";
import {
  isRepositoryOperationStorageError,
  isRepositoryStorageError,
  type RepositoryOperationStorageError,
} from "../../repositoryRuntime/repositoryOperation.js";
import {
  openRepositoryRuntime,
  openSubmissionRepositoryRuntime,
  type RepositoryRuntimeLoadError,
  type SubmissionRepositoryRuntimeLoadError,
} from "../../repositoryRuntime/repositoryRuntime.js";
import { taskReviewBuiltInInstructions } from "../../reviewerPrompts/taskReviewerPrompt.js";
import { taskSimplificationAdviceBuiltInInstructions } from "../../reviewerPrompts/taskSimplificationAdvicePrompt.js";
import type { SubmitProgress } from "../../submission/submissionProgress.js";
import { readRepositoryFileAtCommit } from "../../submissionEnvironment/adapters/repositoryFile.js";
import { openSqliteTaskChangeReviewAdmissionPersistence } from "../../taskChange/adapters/sqlite/sqliteTaskChangeReviewAdmissionPersistence.js";
import {
  admitTaskReview,
  openSqliteTaskReviewPersistence,
  taskReviewAdmissionRejection,
} from "../adapters/sqlite/sqliteTaskReviewPersistence.js";
import { type RepoTaskIdResolution, resolveRepoTaskId } from "../repoTaskIds.js";
import {
  readCurrentWorktreeReviewBase,
  verifyRecordedTaskReviewBase,
} from "../review/adapters/taskReviewGit.js";
import {
  resolveTaskReviewPolicy,
  resolveTaskSimplificationAdvicePolicy,
} from "../review/taskReviewConfig.js";
import type { TaskReviewerOutput } from "../review/taskReviewerOutput.js";
import type { CompleteTaskReviewSuccess } from "../review/taskReviewPersistence.js";
import {
  abandonTaskReview,
  inspectTaskReviewIdentity,
  openTaskReviewUseCases,
  type TaskReviewInspectionUseCases,
  type TaskReviewRecoveryUseCases,
  type TaskReviewSubmitResult,
} from "../review/taskReviewUseCases.js";
import type {
  TaskSimplificationAdvice,
  TaskSimplificationAdviceAttempt,
} from "../review/taskSimplificationAdvice.js";
import type { TaskSimplificationAdviceOutput } from "../review/taskSimplificationAdviceOutput.js";
import type { PublicTaskId } from "../taskId.js";

export type LoadTaskReviewError =
  | RepositoryRuntimeLoadError
  | SubmissionRepositoryRuntimeLoadError
  | { readonly code: "task_review_config_invalid"; readonly message: string };

type TaskReviewOperationError<E> = E | RepositoryStorageError | RepositoryOperationStorageError;

const retainRepositoryIdentity = <A, E, R>(
  idPrefix: string,
  program: Effect.Effect<A, TaskReviewOperationError<E>, R>,
): Effect.Effect<A, TaskReviewOperationError<E>, R> =>
  program.pipe(
    Effect.mapError((error) =>
      isRepositoryOperationStorageError(error)
        ? error
        : isRepositoryStorageError(error)
          ? {
              _tag: "RepositoryOperationStorageError" as const,
              error,
              idPrefix,
            }
          : error,
    ),
  );

export const withTaskReviewInspectionUseCases = <A, E, R>(
  input: { readonly cwd: string },
  use: (reviews: TaskReviewInspectionUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError | RepositoryOperationStorageError,
  R
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return retainRepositoryIdentity(
    context.idPrefix,
    loaded.runtime.provide(
      openSqliteTaskReviewPersistence().pipe(
        Effect.flatMap((persistence) =>
          use({
            getById: persistence.getById,
            proposalIsCurrent: persistence.proposalIsCurrent,
            inspectIdentity: (review) =>
              inspectTaskReviewIdentity(
                {
                  repositoryRoot: context.root,
                  repositoryCommonDirectory: context.commonDirectory,
                  verifyReviewBase: verifyRecordedTaskReviewBase,
                  inspectWorkspace: inspectDisposableWorktree,
                },
                review,
              ),
          }),
        ),
        Effect.map((value) => ({ ok: true as const, value })),
      ),
    ),
  );
};

export const withTaskReviewRecoveryUseCases = <A, E, R>(
  input: { readonly cwd: string },
  use: (reviews: TaskReviewRecoveryUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError | RepositoryOperationStorageError,
  R
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return retainRepositoryIdentity(
    context.idPrefix,
    loaded.runtime.provide(
      openSqliteTaskReviewPersistence().pipe(
        Effect.flatMap((persistence) =>
          use({
            abandon: (reviewId, reason, now) =>
              abandonTaskReview(
                {
                  repositoryRoot: context.root,
                  repositoryCommonDirectory: context.commonDirectory,
                  persistence,
                  verifyReviewBase: verifyRecordedTaskReviewBase,
                  cleanupWorkspace: cleanupExactDisposableWorkspace,
                },
                reviewId,
                reason,
                now,
              ),
          }),
        ),
        Effect.map((value) => ({ ok: true as const, value })),
      ),
    ),
  );
};

export type TaskReviewRepositorySubmitResult =
  | TaskReviewSubmitResult
  | Exclude<RepoTaskIdResolution, { readonly ok: true }>;

export const withTaskReviewSubmissionUseCases = <A, E, R>(
  input: {
    readonly cwd: string;
    readonly globalConfigPath: string;
    readonly reviewerRuntime?: ReviewerAgentRuntime<TaskReviewerOutput>;
    readonly underengineerRuntime?: ReviewerAgentRuntime<TaskSimplificationAdviceOutput>;
    readonly progress?: SubmitProgress;
    readonly taskId: PublicTaskId;
    readonly now: string;
  },
  use: (result: TaskReviewRepositorySubmitResult) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError | RepositoryOperationStorageError,
  R
> => {
  const reuseRuntime = openSubmissionRepositoryRuntime(input.cwd);
  if (!reuseRuntime.ok) return Effect.succeed(reuseRuntime);
  return retainRepositoryIdentity(
    reuseRuntime.runtime.context.idPrefix,
    reuseRuntime.runtime.provide(
      openSqliteTaskReviewPersistence().pipe(
        Effect.flatMap((persistence) =>
          Effect.all({
            judgment: persistence.reuseJudgment(input.taskId, input.now),
            advice: persistence.getCompletedSimplificationAdvice(input.taskId),
          }),
        ),
      ),
    ),
  ).pipe(
    Effect.flatMap(({ judgment, advice }) =>
      judgment === undefined
        ? submitFreshTaskReview(input, use)
        : use(
            submissionResultWithAdvice(
              judgment,
              advice,
              judgment.review.simplificationAdviceAttempt,
            ),
          ).pipe(Effect.map((value) => ({ ok: true as const, value }))),
    ),
  );
};

const submissionResultWithAdvice = (
  judgment: CompleteTaskReviewSuccess,
  advice: TaskSimplificationAdvice | undefined,
  attempt: TaskSimplificationAdviceAttempt | undefined,
): TaskReviewSubmitResult => {
  if (advice !== undefined) return { ...judgment, simplificationAdvice: advice };
  if (attempt !== undefined) return { ...judgment, simplificationAdviceAttempt: attempt };
  return judgment;
};

const submitFreshTaskReview = <A, E, R>(
  input: {
    readonly cwd: string;
    readonly globalConfigPath: string;
    readonly reviewerRuntime?: ReviewerAgentRuntime<TaskReviewerOutput>;
    readonly underengineerRuntime?: ReviewerAgentRuntime<TaskSimplificationAdviceOutput>;
    readonly progress?: SubmitProgress;
    readonly taskId: PublicTaskId;
    readonly now: string;
  },
  use: (result: TaskReviewRepositorySubmitResult) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError | RepositoryOperationStorageError,
  R
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  const resolved = resolveRepoTaskId(context, input.taskId);
  if (!resolved.ok)
    return use(resolved).pipe(Effect.map((value) => ({ ok: true as const, value })));
  return retainRepositoryIdentity(
    context.idPrefix,
    loaded.runtime.provide(
      Effect.all({
        admission: openSqliteTaskChangeReviewAdmissionPersistence({
          checkAdmission: taskReviewAdmissionRejection,
          admit: admitTaskReview,
        }),
        persistence: openSqliteTaskReviewPersistence(),
      }).pipe(
        Effect.flatMap(({ admission, persistence }) =>
          openTaskReviewUseCases({
            repositoryRoot: context.root,
            repositoryCommonDirectory: context.commonDirectory,
            agentSessionStorageRoot: context.paths.agentSessionsPath,
            loadRepoConfig: (commit) => {
              const source = readRepositoryFileAtCommit(
                context.root,
                commit,
                ".but-why/config.json",
              );
              if (!source.ok)
                return { ok: false, message: `Repo Config is missing at Review Base ${commit}.` };
              const decoded = decodeRepoConfigSource(source.content);
              if (!decoded.ok) return { ok: false, message: decoded.error.message };
              return decoded.config.idPrefix === context.idPrefix
                ? decoded
                : {
                    ok: false,
                    message: `Repo Config idPrefix at Review Base is ${decoded.config.idPrefix}; expected ${context.idPrefix}.`,
                  };
            },
            resolvePolicy: (repoConfig, commit) => {
              const global = readGlobalConfig(input.globalConfigPath);
              if (!global.ok) return { ok: false, message: global.error.message };
              return resolveTaskReviewPolicy({
                repoConfig,
                globalConfig: global.config,
                globalConfigPath: input.globalConfigPath,
                builtInInstructions: taskReviewBuiltInInstructions,
                readRepoGuidance: (path) => {
                  const source = readRepositoryFileAtCommit(context.root, commit, path);
                  return source.ok
                    ? { ok: true, content: source.content }
                    : {
                        ok: false,
                        message: `Could not read Task Review guidance file ${path} from Review Base ${commit}.`,
                      };
                },
                readGlobalGuidance: (path) => {
                  try {
                    return { ok: true, content: readFileSync(path, "utf8") };
                  } catch (error) {
                    return {
                      ok: false,
                      message: `Could not read Task Review guidance file ${path}: ${errorMessage(error)}`,
                    };
                  }
                },
              });
            },
            resolveSimplificationAdvicePolicy: (repoConfig, _commit) => {
              const global = readGlobalConfig(input.globalConfigPath);
              if (!global.ok) return { ok: false, message: global.error.message };
              return resolveTaskSimplificationAdvicePolicy({
                repoConfig,
                globalConfig: global.config,
                globalConfigDirectory: dirname(input.globalConfigPath),
                builtInInstructions: taskSimplificationAdviceBuiltInInstructions,
              });
            },
            admission,
            persistence,
            reviewerRuntime: input.reviewerRuntime ?? piReviewerAgentRuntime,
            underengineerRuntime: input.underengineerRuntime ?? piReviewerAgentRuntime,
            reviewerExecutor: piReviewerProcessExecutor,
            readReviewBase: readCurrentWorktreeReviewBase,
            verifyReviewBase: verifyRecordedTaskReviewBase,
            runWorkspace: runDisposableExactCommitWorkspace,
            restoreWorkspace: restoreDisposableWorkspace,
            cleanupWorkspace: cleanupExactDisposableWorkspace,
            inspectWorkspace: inspectDisposableWorktree,
            ...(input.progress === undefined ? {} : { progress: input.progress }),
          }).submit(resolved.taskId, input.now),
        ),
        Effect.flatMap(use),
        Effect.map((value) => ({ ok: true as const, value })),
      ),
    ),
  );
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
