import { dirname } from "node:path";
import { Effect } from "effect";
import { piReviewerProcessExecutor } from "../../agent/adapters/piReviewerProcessExecutor.js";
import { resolveAgentProfile } from "../../agent/agentProfiles.js";
import { validatePiAgentProfileResources } from "../../agent/piRuntime.js";
import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../../agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../agent/reviewerOutput.js";
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
  type RepositoryRuntimeLoadError,
} from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteTaskReviewPersistence } from "../../sqlite/sqliteTaskReviewPersistence.js";
import { readRepositoryFileAtCommit } from "../../submissionEnvironment/adapters/repositoryFile.js";
import {
  readCanonicalMainReviewBase,
  verifyRecordedTaskReviewBase,
} from "../review/taskReviewGit.js";
import {
  abandonTaskReview,
  inspectTaskReviewIdentity,
  openTaskReviewUseCases,
  type TaskReviewReadUseCases,
  type TaskReviewUseCases,
} from "../review/taskReviewUseCases.js";

export type LoadTaskReviewError =
  | RepositoryRuntimeLoadError
  | { readonly code: "task_review_config_invalid"; readonly message: string };

export const withTaskReviewReadUseCases = <A, E, R>(
  input: { readonly cwd: string },
  use: (reviews: TaskReviewReadUseCases) => Effect.Effect<A, E, R>,
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
          getById: persistence.getById,
          getLatestForTask: persistence.getLatestForTask,
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

export const withTaskReviewUseCases = <A, E, R>(
  input: {
    readonly cwd: string;
    readonly globalConfigPath: string;
    readonly reviewerRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  },
  use: (reviews: TaskReviewUseCases) => Effect.Effect<A, E, R>,
): Effect.Effect<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: LoadTaskReviewError },
  E | RepositoryStorageError,
  R
> => {
  const loaded = openRepositoryRuntime(input.cwd);
  if (!loaded.ok) return Effect.succeed(loaded);
  const global = readGlobalConfig(input.globalConfigPath);
  if (!global.ok) {
    return Effect.succeed({
      ok: false,
      error: { code: "task_review_config_invalid", message: global.error.message },
    });
  }
  const profile = resolveAgentProfile({
    ...(global.config.defaultAgentProfile === undefined
      ? {}
      : { defaultSelection: global.config.defaultAgentProfile }),
    ...(global.config.agentProfiles === undefined
      ? {}
      : { globalProfiles: global.config.agentProfiles }),
    globalConfigDirectory: dirname(input.globalConfigPath),
  });
  if (!profile.ok) {
    const error = profile.error;
    const message =
      error._tag === "MissingAgentProfile"
        ? error.profileName === undefined
          ? "Global Config needs a default Agent Profile for Task Review."
          : `Global Agent Profile "${error.profileName}" was not found.`
        : error._tag === "MissingAgentModel"
          ? `Global Agent Profile "${error.profileName}" has no Pi model in runtimeConfig.`
          : `Global Agent Profile "${error.profileName}" uses unsupported runtime "${error.agentRuntime}".`;
    return Effect.succeed({
      ok: false,
      error: { code: "task_review_config_invalid", message },
    });
  }
  const context = loaded.runtime.context;
  const resources = validatePiAgentProfileResources(profile.resolved, context.mainCheckoutRoot);
  if (!resources.ok) {
    return Effect.succeed({
      ok: false,
      error: { code: "task_review_config_invalid", message: resources.error.message },
    });
  }
  return loaded.runtime.provide(
    openSqliteTaskReviewPersistence().pipe(
      Effect.flatMap((persistence) =>
        use(
          openTaskReviewUseCases({
            mainCheckoutRoot: context.mainCheckoutRoot,
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
            profile: profile.resolved,
            persistence,
            reviewerRuntime: input.reviewerRuntime ?? piReviewerAgentRuntime,
            reviewerExecutor: piReviewerProcessExecutor,
            readReviewBase: readCanonicalMainReviewBase,
            verifyReviewBase: verifyRecordedTaskReviewBase,
            runWorkspace: runDisposableExactCommitWorkspace,
            cleanupWorkspace: cleanupExactDisposableWorkspace,
            inspectWorkspace: inspectDisposableWorktree,
          }),
        ),
      ),
      Effect.map((value) => ({ ok: true as const, value })),
    ),
  );
};
