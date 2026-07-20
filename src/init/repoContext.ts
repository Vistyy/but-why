import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { RepoConfig } from "../contracts/repoConfig.js";
import { isTaskPrefix } from "../contracts/taskPrefix.js";
import { findGitRoot } from "./git.js";
import { ensureGitignoreBlock } from "./gitignore.js";
import { readRepoConfig, writeRepoConfig } from "./repoConfig.js";
import {
  initializeStateDatabase,
  prepareStateDatabase,
  SharedStateIdentityConflictError,
  type StateDatabase,
} from "./stateDatabase.js";

export type RepoLocalPaths = {
  readonly butWhyDir: string;
  readonly operationalDir: string;
  readonly configPath: string;
  readonly statePath: string;
  readonly reviewersPath: string;
  readonly artifactsPath: string;
  readonly taskContextDraftsPath: string;
  readonly gitignorePath: string;
};

export type RepoLocalContext = {
  readonly root: string;
  readonly commonDirectory: string;
  readonly taskPrefix: string;
  readonly config: RepoConfig;
  readonly paths: RepoLocalPaths;
  readonly stateDatabase: StateDatabase;
};

export type InitRepoInput = {
  readonly cwd: string;
  readonly taskPrefix: string;
};

export type InitRepoResult =
  | {
      readonly ok: true;
      readonly status: "initialized" | "repaired" | "unchanged";
      readonly root: string;
      readonly taskPrefix: string;
      readonly created: readonly string[];
      readonly updated: readonly string[];
    }
  | {
      readonly ok: false;
      readonly error: InitRepoError;
    };

export type InitRepoError =
  | {
      readonly code: "invalid_task_prefix";
      readonly taskPrefix: string;
    }
  | {
      readonly code: "not_git_work_tree";
    }
  | {
      readonly code: "invalid_repo_config";
      readonly error: import("../contracts/configErrors.js").RepoConfigValidationFailed;
    }
  | {
      readonly code: "task_prefix_conflict";
      readonly existingTaskPrefix: string;
      readonly requestedTaskPrefix: string;
    }
  | {
      readonly code: "invalid_repo_state";
      readonly path: string;
      readonly expected: string;
    }
  | {
      readonly code: "shared_state_identity_conflict";
    };

export type LoadRepoLocalContextResult =
  | {
      readonly ok: true;
      readonly context: RepoLocalContext;
    }
  | {
      readonly ok: false;
      readonly error: LoadRepoLocalContextError;
    };

export type LoadRepoLocalContextError =
  | {
      readonly code: "not_initialized";
    }
  | {
      readonly code: "invalid_repo_config";
      readonly error: import("../contracts/configErrors.js").RepoConfigValidationFailed;
    }
  | {
      readonly code: "shared_state_identity_conflict";
    }
  | {
      readonly code: "state_store_unavailable";
      readonly taskPrefix: string;
    };

const repoLocalPaths = (root: string, commonDirectory: string): RepoLocalPaths => {
  const butWhyDir = join(root, ".but-why");
  const operationalDir = join(commonDirectory, "but-why");

  return {
    butWhyDir,
    operationalDir,
    configPath: join(butWhyDir, "config.json"),
    statePath: join(operationalDir, "state.sqlite"),
    reviewersPath: join(butWhyDir, "reviewers"),
    artifactsPath: join(operationalDir, "artifacts"),
    taskContextDraftsPath: join(operationalDir, "task-context-drafts"),
    gitignorePath: join(root, ".gitignore"),
  };
};

export const initRepoLocalContext = (input: InitRepoInput): InitRepoResult => {
  if (!isTaskPrefix(input.taskPrefix)) {
    return {
      ok: false,
      error: {
        code: "invalid_task_prefix",
        taskPrefix: input.taskPrefix,
      },
    };
  }

  const gitRoot = findGitRoot(input.cwd);

  if (!gitRoot.ok) {
    return { ok: false, error: { code: "not_git_work_tree" } };
  }

  const paths = repoLocalPaths(gitRoot.root, gitRoot.commonDirectory);
  const created: string[] = [];
  const updated: string[] = [];

  mkdirSync(paths.butWhyDir, { recursive: true });
  mkdirSync(paths.operationalDir, { recursive: true });

  const configResult = ensureRepoConfig(paths.configPath, input.taskPrefix);

  if (!configResult.ok) {
    return { ok: false, error: configResult.error };
  }

  if (configResult.created) {
    created.push(".but-why/config.json");
  }

  let stateChange: ReturnType<typeof initializeStateDatabase>;

  try {
    stateChange = initializeStateDatabase({
      statePath: paths.statePath,
      commonDirectory: gitRoot.commonDirectory,
    });
  } catch (error) {
    if (error instanceof SharedStateIdentityConflictError) {
      return { ok: false, error: { code: "shared_state_identity_conflict" } };
    }
    throw error;
  }

  if (stateChange.change === "created") {
    created.push("<git-common-dir>/but-why/state.sqlite");
  }

  const reviewersRepair = ensureReviewersPath(paths.reviewersPath);

  if (!reviewersRepair.ok) {
    return { ok: false, error: reviewersRepair.error };
  }

  if (reviewersRepair.created) {
    created.push(".but-why/reviewers/");
  }

  if (ensureGitignoreBlock(paths.gitignorePath)) {
    updated.push(".gitignore");
  }

  const status = configResult.created
    ? "initialized"
    : created.length > 0 || updated.length > 0
      ? "repaired"
      : "unchanged";

  return {
    ok: true,
    status,
    root: gitRoot.root,
    taskPrefix: input.taskPrefix,
    created,
    updated,
  };
};

export const loadRepoLocalContext = (cwd: string): LoadRepoLocalContextResult => {
  const gitRoot = findGitRoot(cwd);

  if (!gitRoot.ok) {
    return { ok: false, error: { code: "not_initialized" } };
  }

  const paths = repoLocalPaths(gitRoot.root, gitRoot.commonDirectory);

  if (!existsSync(paths.configPath)) {
    return { ok: false, error: { code: "not_initialized" } };
  }

  const repoConfig = readRepoConfig(paths.configPath);

  if (!repoConfig.ok) {
    return { ok: false, error: { code: "invalid_repo_config", error: repoConfig.error } };
  }

  let stateDatabase: StateDatabase;

  try {
    stateDatabase = existsSync(paths.statePath)
      ? initializeStateDatabase({
          statePath: paths.statePath,
          commonDirectory: gitRoot.commonDirectory,
        }).database
      : prepareStateDatabase({
          statePath: paths.statePath,
          commonDirectory: gitRoot.commonDirectory,
        });
  } catch (error) {
    if (error instanceof SharedStateIdentityConflictError) {
      return { ok: false, error: { code: "shared_state_identity_conflict" } };
    }
    return {
      ok: false,
      error: { code: "state_store_unavailable", taskPrefix: repoConfig.config.taskPrefix },
    };
  }

  return {
    ok: true,
    context: {
      root: gitRoot.root,
      commonDirectory: gitRoot.commonDirectory,
      paths,
      taskPrefix: repoConfig.config.taskPrefix,
      config: repoConfig.config,
      stateDatabase,
    },
  };
};

type RepoConfigEnsureResult =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly error: InitRepoError };

const ensureRepoConfig = (configPath: string, taskPrefix: string): RepoConfigEnsureResult => {
  if (!existsSync(configPath)) {
    writeRepoConfig(configPath, taskPrefix);
    return { ok: true, created: true };
  }

  const config = readRepoConfig(configPath);

  if (!config.ok) {
    return { ok: false, error: { code: "invalid_repo_config", error: config.error } };
  }

  if (config.config.taskPrefix !== taskPrefix) {
    return {
      ok: false,
      error: {
        code: "task_prefix_conflict",
        existingTaskPrefix: config.config.taskPrefix,
        requestedTaskPrefix: taskPrefix,
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
