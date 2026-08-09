import { existsSync } from "node:fs";

import { Effect } from "effect";

import {
  piReviewerAgentRuntime,
  type ReviewerAgentRuntime,
} from "../agent/reviewerAgentRuntime.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { readGlobalConfig } from "../init/globalConfig.js";
import { decodeRepoConfigSource } from "../init/repoConfig.js";
import {
  type LoadRepoLocalContextError,
  loadRepoLocalSubmissionContext,
} from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import { openSqliteTaskReviewPersistence } from "../sqlite/sqliteTaskReviewPersistence.js";
import { runGitCommand } from "../submissionEnvironment/gitFacts.js";
import { readRepositoryFileAtCommit } from "../submissionEnvironment/repositoryFile.js";
import { openTaskSubmission, type TaskSubmission, type TaskSubmitResult } from "./submitTask.js";

export type LoadTaskSubmissionResult =
  | { readonly ok: true; readonly submission: TaskSubmission }
  | {
      readonly ok: false;
      readonly error: LoadRepoLocalContextError | { readonly code: "state_store_unavailable" };
    };

export const loadTaskSubmission = (input: {
  readonly cwd: string;
  readonly globalConfigPath: string;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
}): LoadTaskSubmissionResult => {
  const repoContext = loadRepoLocalSubmissionContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  const context = repoContext.context;
  if (!existsSync(context.paths.statePath)) {
    return { ok: false, error: { code: "state_store_unavailable" } };
  }

  const repositoryLayer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
  });

  return {
    ok: true,
    submission: {
      submit: (submitInput): Effect.Effect<TaskSubmitResult, RepositoryStorageError> =>
        openSqliteTaskReviewPersistence().pipe(
          Effect.flatMap((persistence) =>
            openTaskSubmission({
              persistence,
              executionLock: openSqliteExecutionLock({
                commonDirectory: context.commonDirectory,
              }),
              mainCheckoutRoot: context.mainCheckoutRoot,
              globalConfigPath: input.globalConfigPath,
              readMainCheckoutHead: (cwd) => {
                const head = runGitCommand(["rev-parse", "--verify", "HEAD^{commit}"], cwd);
                return head.ok
                  ? { ok: true as const, commit: head.stdout.trim() }
                  : { ok: false as const };
              },
              readRepoConfigAtCommit: (cwd, commit) => {
                const source = readRepositoryFileAtCommit(cwd, commit, ".but-why/config.json");
                if (!source.ok) {
                  return {
                    ok: false as const,
                    message: `Repo Config could not be read at commit ${commit}.`,
                  };
                }
                const decoded = decodeRepoConfigSource(source.content, ".but-why/config.json");
                return decoded.ok
                  ? decoded
                  : {
                      ok: false as const,
                      message: `Repo Config is invalid: ${decoded.error.message}`,
                    };
              },
              readGlobalConfig: (path) => {
                const global = readGlobalConfig(path);
                return global.ok ? global : { ok: false as const, message: global.error.message };
              },
              reviewerAgentRuntime: input.reviewerAgentRuntime ?? piReviewerAgentRuntime,
            }).submit(submitInput),
          ),
          Effect.provide(repositoryLayer),
        ),
    },
  };
};
