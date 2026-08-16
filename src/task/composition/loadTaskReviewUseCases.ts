import { readFileSync } from "node:fs";
import { join } from "node:path";
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
} from "../../disposableWorkspace/adapters/disposableWorkspaceGit.js";
import { runDisposableExactCommitWorkspace } from "../../disposableWorkspace/adapters/runDisposableExactCommitWorkspace.js";
import { readGlobalConfig } from "../../init/adapters/globalConfig.js";
import { decodeRepoConfigSource } from "../../init/adapters/repoConfig.js";
import {
  openRepositoryRuntime,
  openSubmissionRepositoryRuntime,
  type RepositoryRuntimeLoadError,
  type SubmissionRepositoryRuntimeLoadError,
} from "../../repositoryRuntime/repositoryRuntime.js";
import { taskReviewBuiltInInstructions } from "../../reviewerPrompts/taskReviewerPrompt.js";
import { openSqliteAgentSessionPersistence } from "../../sqlite/sqliteAgentSessionPersistence.js";
import { openSqliteTaskReviewPersistence } from "../../sqlite/sqliteTaskReviewPersistence.js";
import type { SubmitProgress } from "../../submission/submissionProgress.js";
import {
  readRepositoryFileAtCommit,
  repositoryPathExistsAtCommit,
} from "../../submissionEnvironment/adapters/repositoryFile.js";
import { openSqliteTaskChangeReviewAdmissionPersistence } from "../../taskChange/adapters/sqlite/sqliteTaskChangeReviewAdmissionPersistence.js";
import { type RepoTaskIdResolution, resolveRepoTaskId } from "../repoTaskIds.js";
import {
  readCanonicalMainReviewBase,
  verifyRecordedTaskReviewBase,
} from "../review/adapters/taskReviewGit.js";
import { resolveTaskReviewPolicy } from "../review/taskReviewConfig.js";
import type { TaskReviewerOutput } from "../review/taskReviewerOutput.js";
import {
  abandonTaskReview,
  inspectTaskReviewIdentity,
  openTaskReviewUseCases,
  type TaskReviewInspectionUseCases,
  type TaskReviewRecoveryUseCases,
  type TaskReviewSubmitResult,
} from "../review/taskReviewUseCases.js";
import type { PublicTaskId } from "../taskId.js";

export type LoadTaskReviewError =
  | RepositoryRuntimeLoadError
  | SubmissionRepositoryRuntimeLoadError
  | { readonly code: "task_review_config_invalid"; readonly message: string };

export const withTaskReviewInspectionUseCases = <A, E, R>(
  input: { readonly cwd: string },
  use: (reviews: TaskReviewInspectionUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError,
  R
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return loaded.runtime.provide(
    openSqliteTaskReviewPersistence().pipe(
      Effect.flatMap((persistence) =>
        use({
          getById: persistence.getById,
          getLatestForTask: persistence.getLatestForTask,
          listForTask: persistence.listForTask,
          proposalIsCurrent: persistence.proposalIsCurrent,
          inspectIdentity: (review) =>
            inspectTaskReviewIdentity(
              {
                mainCheckoutRoot: context.mainCheckoutRoot,
                verifyReviewBase: verifyRecordedTaskReviewBase,
                inspectWorkspace: inspectDisposableWorktree,
              },
              review,
            ),
        }),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

export const withTaskReviewRecoveryUseCases = <A, E, R>(
  input: { readonly cwd: string },
  use: (reviews: TaskReviewRecoveryUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError,
  R
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  return loaded.runtime.provide(
    openSqliteTaskReviewPersistence().pipe(
      Effect.flatMap((persistence) =>
        use({
          abandon: (reviewId, reason, now) =>
            abandonTaskReview(
              {
                mainCheckoutRoot: context.mainCheckoutRoot,
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
    readonly progress?: SubmitProgress;
    readonly taskId: PublicTaskId;
    readonly now: string;
  },
  use: (result: TaskReviewRepositorySubmitResult) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError,
  R
> => {
  const reuseRuntime = openSubmissionRepositoryRuntime(input.cwd);
  if (!reuseRuntime.ok) return Effect.succeed(reuseRuntime);
  return reuseRuntime.runtime
    .provide(
      openSqliteTaskReviewPersistence().pipe(
        Effect.flatMap((persistence) => persistence.reuseJudgment(input.taskId, input.now)),
      ),
    )
    .pipe(
      Effect.flatMap((judgment) =>
        judgment === undefined
          ? submitFreshTaskReview(input, use)
          : use(judgment).pipe(Effect.map((value) => ({ ok: true as const, value }))),
      ),
    );
};

const submitFreshTaskReview = <A, E, R>(
  input: {
    readonly cwd: string;
    readonly globalConfigPath: string;
    readonly reviewerRuntime?: ReviewerAgentRuntime<TaskReviewerOutput>;
    readonly progress?: SubmitProgress;
    readonly taskId: PublicTaskId;
    readonly now: string;
  },
  use: (result: TaskReviewRepositorySubmitResult) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError,
  R
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const context = loaded.runtime.context;
  const resolved = resolveRepoTaskId(context, input.taskId);
  if (!resolved.ok)
    return use(resolved).pipe(Effect.map((value) => ({ ok: true as const, value })));
  return loaded.runtime.provide(
    Effect.all({
      admission: openSqliteTaskChangeReviewAdmissionPersistence(),
      persistence: openSqliteTaskReviewPersistence(),
      agentPersistence: openSqliteAgentSessionPersistence(),
    }).pipe(
      Effect.flatMap(({ admission, persistence, agentPersistence }) =>
        openTaskReviewUseCases({
          mainCheckoutRoot: context.mainCheckoutRoot,
          reviewerSessionStorageRoot: join(context.paths.operationalDir, "task-review-sessions"),
          loadRepoConfig: (commit) => {
            const source = readRepositoryFileAtCommit(
              context.mainCheckoutRoot,
              commit,
              ".but-why/config.json",
            );
            if (!source.ok)
              return { ok: false, message: `Repo Config is missing at Review Base ${commit}.` };
            const decoded = decodeRepoConfigSource(source.content);
            if (!decoded.ok) return { ok: false, message: decoded.error.message };
            return decoded.config.taskPrefix === context.taskPrefix
              ? decoded
              : {
                  ok: false,
                  message: `Repo Config taskPrefix at Review Base is ${decoded.config.taskPrefix}; expected ${context.taskPrefix}.`,
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
                const source = readRepositoryFileAtCommit(context.mainCheckoutRoot, commit, path);
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
              repoResourceExists: (path) =>
                repositoryPathExistsAtCommit(context.mainCheckoutRoot, commit, path),
            });
          },
          admission,
          persistence,
          agentPersistence,
          reviewerRuntime: input.reviewerRuntime ?? piReviewerAgentRuntime,
          reviewerExecutor: piReviewerProcessExecutor,
          readReviewBase: readCanonicalMainReviewBase,
          verifyReviewBase: verifyRecordedTaskReviewBase,
          runWorkspace: runDisposableExactCommitWorkspace,
          cleanupWorkspace: cleanupExactDisposableWorkspace,
          inspectWorkspace: inspectDisposableWorktree,
          ...(input.progress === undefined ? {} : { progress: input.progress }),
        }).submit(resolved.taskId, input.now),
      ),
      Effect.flatMap(use),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
