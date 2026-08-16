import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Effect } from "effect";

import type { RepoConfigValidationFailed } from "../contracts/configErrors.js";
import { isIdPrefix } from "../contracts/idPrefix.js";
import type { RepoConfig } from "../contracts/repoConfig.js";
import {
  type PredecessorReconciliationBlockedConditions,
  RepositoryIdentityConflict,
  RepositoryIdPrefixConflict,
  RepositoryMigrationFailed,
  RepositoryPredecessorReconciliationRequired,
  RepositoryRestoredTransientState,
  RepositorySqlOperationFailed,
  RepositoryStateUnavailable,
  type RestoredTransientChangeFact,
  type RestoredTransientTaskFact,
} from "../contracts/repositoryStorageError.js";
import { findCurrentWorktreeFacts, findGitRoot } from "../init/adapters/git.js";
import { readRepoConfig, writeRepoConfig } from "../init/adapters/repoConfig.js";
import { RepositorySql, repositorySqlLayer } from "../sqlite/repositorySql.js";

export type LocalRepositoryPaths = {
  readonly butWhyDir: string;
  readonly operationalDir: string;
  readonly configPath: string;
  readonly statePath: string;
  readonly reviewersPath: string;
  readonly artifactsPath: string;
  readonly snapshotsPath: string;
  readonly taskContextDraftsPath: string;
};

export const findCurrentRepositoryWorktreeFacts = findCurrentWorktreeFacts;

export type LocalRepositoryContext = {
  readonly root: string;
  readonly mainCheckoutRoot: string;
  readonly commonDirectory: string;
  readonly idPrefix: string;
  readonly config: RepoConfig;
  readonly paths: LocalRepositoryPaths;
};

export type InitRepoInput = {
  readonly cwd: string;
  readonly idPrefix: string;
};

export type InitRepoResult =
  | {
      readonly ok: true;
      readonly status: "initialized" | "repaired" | "unchanged";
      readonly root: string;
      readonly idPrefix: string;
      readonly created: readonly string[];
      readonly updated: readonly string[];
    }
  | {
      readonly ok: false;
      readonly error: InitRepoError;
    };

export type InitRepoError =
  | {
      readonly code: "invalid_id_prefix";
      readonly idPrefix: string;
    }
  | {
      readonly code: "not_git_work_tree";
    }
  | {
      readonly code: "invalid_repo_config";
      readonly error: RepoConfigValidationFailed;
    }
  | {
      readonly code: "id_prefix_conflict";
      readonly existingIdPrefix: string;
      readonly requestedIdPrefix: string;
    }
  | {
      readonly code: "invalid_repo_state";
      readonly path: string;
      readonly expected: string;
    }
  | {
      readonly code: "shared_state_identity_conflict";
    }
  | {
      readonly code: "state_store_unavailable";
    }
  | {
      readonly code: "predecessor_reconciliation_required";
      readonly blocked: PredecessorReconciliationBlockedConditions;
    }
  | {
      readonly code: "restored_transient_state";
      readonly tasks: readonly RestoredTransientTaskFact[];
      readonly changes: readonly RestoredTransientChangeFact[];
    };

export type LocalRepositorySubmissionContext = Omit<LocalRepositoryContext, "config">;

export type ResolveLocalRepositoryResult =
  | {
      readonly ok: true;
      readonly context: LocalRepositoryContext;
    }
  | {
      readonly ok: false;
      readonly error: ResolveLocalRepositoryError;
    };

export type ResolveLocalRepositoryError =
  | {
      readonly code: "not_initialized";
    }
  | {
      readonly code: "main_checkout_unavailable";
      readonly path?: string;
    }
  | {
      readonly code: "invalid_repo_config";
      readonly error: RepoConfigValidationFailed;
    }
  | {
      readonly code: "shared_state_identity_conflict";
    }
  | {
      readonly code: "id_prefix_conflict";
      readonly configuredIdPrefix: string;
      readonly storedIdPrefix: string;
    }
  | {
      readonly code: "state_store_unavailable";
      readonly idPrefix: string;
    };

const repoLocalPaths = (root: string, commonDirectory: string): LocalRepositoryPaths => {
  const butWhyDir = join(root, ".but-why");
  const operationalDir = join(commonDirectory, "but-why");

  return {
    butWhyDir,
    operationalDir,
    configPath: join(butWhyDir, "config.json"),
    statePath: join(operationalDir, "state.sqlite"),
    reviewersPath: join(butWhyDir, "reviewers"),
    artifactsPath: join(operationalDir, "artifacts"),
    snapshotsPath: join(operationalDir, "snapshots"),
    taskContextDraftsPath: join(operationalDir, "task-context-drafts"),
  };
};

type PreparedRepoInitialization = {
  readonly input: InitRepoInput;
  readonly root: string;
  readonly commonDirectory: string;
  readonly paths: LocalRepositoryPaths;
  readonly configCreated: boolean;
};

type PrepareRepoInitializationResult =
  | { readonly ok: true; readonly prepared: PreparedRepoInitialization }
  | { readonly ok: false; readonly result: InitRepoResult };

const prepareRepoInitialization = (input: InitRepoInput): PrepareRepoInitializationResult => {
  if (!isIdPrefix(input.idPrefix)) {
    return {
      ok: false,
      result: {
        ok: false,
        error: {
          code: "invalid_id_prefix",
          idPrefix: input.idPrefix,
        },
      },
    };
  }

  const gitRoot = findGitRoot(input.cwd);

  if (!gitRoot.ok) {
    return { ok: false, result: { ok: false, error: { code: "not_git_work_tree" } } };
  }

  const paths = repoLocalPaths(gitRoot.root, gitRoot.commonDirectory);
  mkdirSync(paths.butWhyDir, { recursive: true });
  mkdirSync(paths.operationalDir, { recursive: true });

  const configResult = ensureRepoConfig(paths.configPath, input.idPrefix);

  if (!configResult.ok) {
    return { ok: false, result: { ok: false, error: configResult.error } };
  }

  return {
    ok: true,
    prepared: {
      input,
      root: gitRoot.root,
      commonDirectory: gitRoot.commonDirectory,
      paths,
      configCreated: configResult.created,
    },
  };
};

const completeRepoInitialization = (
  prepared: PreparedRepoInitialization,
  stateChange: "created" | "unchanged",
): InitRepoResult => {
  const created: string[] = [];
  const updated: string[] = [];

  if (prepared.configCreated) created.push(".but-why/config.json");
  if (stateChange === "created") created.push("<git-common-dir>/but-why/state.sqlite");

  const reviewersRepair = ensureReviewersPath(prepared.paths.reviewersPath);

  if (!reviewersRepair.ok) {
    return { ok: false, error: reviewersRepair.error };
  }

  if (reviewersRepair.created) created.push(".but-why/reviewers/");

  const status = prepared.configCreated
    ? "initialized"
    : created.length > 0 || updated.length > 0
      ? "repaired"
      : "unchanged";

  return {
    ok: true,
    status,
    root: prepared.root,
    idPrefix: prepared.input.idPrefix,
    created,
    updated,
  };
};

export const initializeRepositoryRuntime = (
  input: InitRepoInput,
): Effect.Effect<InitRepoResult> => {
  const preparation = prepareRepoInitialization(input);
  if (!preparation.ok) return Effect.succeed(preparation.result);

  const prepared = preparation.prepared;
  const stateChange = existsSync(prepared.paths.statePath) ? "unchanged" : "created";
  const acquireRepositorySql = RepositorySql.pipe(
    Effect.provide(
      repositorySqlLayer({
        statePath: prepared.paths.statePath,
        commonDirectory: prepared.commonDirectory,
        idPrefix: prepared.input.idPrefix,
        lifecycle: "initialize",
      }),
    ),
  );

  return Effect.scoped(acquireRepositorySql).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        error instanceof RepositoryIdentityConflict
          ? Effect.succeed<InitRepoResult>({
              ok: false,
              error: { code: "shared_state_identity_conflict" },
            })
          : error instanceof RepositoryIdPrefixConflict
            ? Effect.succeed<InitRepoResult>({
                ok: false,
                error: {
                  code: "id_prefix_conflict",
                  existingIdPrefix: error.storedIdPrefix,
                  requestedIdPrefix: error.configuredIdPrefix,
                },
              })
            : error instanceof RepositoryPredecessorReconciliationRequired
              ? Effect.succeed<InitRepoResult>({
                  ok: false,
                  error: {
                    code: "predecessor_reconciliation_required",
                    blocked: error.blocked,
                  },
                })
              : error instanceof RepositoryRestoredTransientState
                ? Effect.succeed<InitRepoResult>({
                    ok: false,
                    error: {
                      code: "restored_transient_state",
                      tasks: error.tasks,
                      changes: error.changes,
                    },
                  })
                : error instanceof RepositoryStateUnavailable ||
                    error instanceof RepositoryMigrationFailed ||
                    error instanceof RepositorySqlOperationFailed
                  ? Effect.succeed<InitRepoResult>({
                      ok: false,
                      error: { code: "state_store_unavailable" },
                    })
                  : Effect.die(error),
      onSuccess: () => Effect.sync(() => completeRepoInitialization(prepared, stateChange)),
    }),
  );
};

export const resolveLocalRepositorySubmission = (
  cwd: string,
):
  | { readonly ok: true; readonly context: LocalRepositorySubmissionContext }
  | { readonly ok: false; readonly error: ResolveLocalRepositoryError } => {
  const resolved = resolveLocalRepository(cwd);
  if (!resolved.ok) return resolved;
  const { config: _config, ...context } = resolved.context;
  return { ok: true, context };
};

export const resolveLocalRepository = (cwd: string): ResolveLocalRepositoryResult => {
  const gitRoot = findGitRoot(cwd);

  if (!gitRoot.ok) {
    return {
      ok: false,
      error:
        gitRoot.code === "main_checkout_unavailable"
          ? { code: gitRoot.code, ...(gitRoot.path === undefined ? {} : { path: gitRoot.path }) }
          : { code: "not_initialized" },
    };
  }

  const paths = repoLocalPaths(gitRoot.root, gitRoot.commonDirectory);

  if (!existsSync(paths.configPath)) {
    return { ok: false, error: { code: "not_initialized" } };
  }

  const repoConfig = readRepoConfig(paths.configPath);

  if (!repoConfig.ok) {
    return { ok: false, error: { code: "invalid_repo_config", error: repoConfig.error } };
  }

  return {
    ok: true,
    context: {
      root: gitRoot.root,
      mainCheckoutRoot: gitRoot.mainCheckoutRoot,
      commonDirectory: gitRoot.commonDirectory,
      paths,
      idPrefix: repoConfig.config.idPrefix,
      config: repoConfig.config,
    },
  };
};

type RepoConfigEnsureResult =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly error: InitRepoError };

const ensureRepoConfig = (configPath: string, idPrefix: string): RepoConfigEnsureResult => {
  if (!existsSync(configPath)) {
    writeRepoConfig(configPath, idPrefix);
    return { ok: true, created: true };
  }

  const config = readRepoConfig(configPath);

  if (!config.ok) {
    return { ok: false, error: { code: "invalid_repo_config", error: config.error } };
  }

  if (config.config.idPrefix !== idPrefix) {
    return {
      ok: false,
      error: {
        code: "id_prefix_conflict",
        existingIdPrefix: config.config.idPrefix,
        requestedIdPrefix: idPrefix,
      },
    };
  }

  return { ok: true, created: false };
};

type ReviewersPathRepairResult =
  | {
      readonly ok: true;
      readonly created: boolean;
    }
  | {
      readonly ok: false;
      readonly error: Extract<InitRepoError, { readonly code: "invalid_repo_state" }>;
    };

const ensureReviewersPath = (reviewersPath: string): ReviewersPathRepairResult => {
  if (!existsSync(reviewersPath)) {
    mkdirSync(reviewersPath, { recursive: true });
    return { ok: true, created: true };
  }

  if (!statSync(reviewersPath).isDirectory()) {
    return {
      ok: false,
      error: {
        code: "invalid_repo_state",
        path: ".but-why/reviewers/",
        expected: "directory",
      },
    };
  }

  return { ok: true, created: false };
};
