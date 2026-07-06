import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { findGitRoot } from "./git.js";
import { ensureGitignoreBlock } from "./gitignore.js";
import { readRepoConfig, type RepoConfig, writeRepoConfig } from "./repoConfig.js";
import { ensureStateDatabase } from "./stateDatabase.js";

const taskPrefixPattern = /^[A-Z][A-Z0-9]{1,9}$/;

export type RepoLocalPaths = {
  readonly butWhyDir: string;
  readonly configPath: string;
  readonly statePath: string;
  readonly reviewersPath: string;
  readonly gitignorePath: string;
};

export type RepoLocalContext = {
  readonly root: string;
  readonly taskPrefix: string;
  readonly config: RepoConfig;
  readonly paths: RepoLocalPaths;
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
    };

const isValidTaskPrefix = (taskPrefix: string): boolean => taskPrefixPattern.test(taskPrefix);

export const isPublicTaskIdForPrefix = (taskId: string, taskPrefix: string): boolean =>
  new RegExp(`^${escapeRegExp(taskPrefix)}-[1-9][0-9]*$`).test(taskId);

export const exampleTaskId = (taskPrefix: string): string => `${taskPrefix}-1`;

const repoLocalPaths = (root: string): RepoLocalPaths => {
  const butWhyDir = join(root, ".but-why");

  return {
    butWhyDir,
    configPath: join(butWhyDir, "config.json"),
    statePath: join(butWhyDir, "state.sqlite"),
    reviewersPath: join(butWhyDir, "reviewers"),
    gitignorePath: join(root, ".gitignore"),
  };
};

export const initRepoLocalContext = (input: InitRepoInput): InitRepoResult => {
  if (!isValidTaskPrefix(input.taskPrefix)) {
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

  const paths = repoLocalPaths(gitRoot.root);
  const wasInitialized = existsSync(paths.configPath);
  const created: string[] = [];
  const updated: string[] = [];

  mkdirSync(paths.butWhyDir, { recursive: true });

  if (wasInitialized) {
    const config = readRepoConfig(paths.configPath);

    if (!config.ok || !isValidTaskPrefix(config.config.taskPrefix)) {
      return { ok: false, error: { code: "invalid_repo_config" } };
    }

    if (config.config.taskPrefix !== input.taskPrefix) {
      return {
        ok: false,
        error: {
          code: "task_prefix_conflict",
          existingTaskPrefix: config.config.taskPrefix,
          requestedTaskPrefix: input.taskPrefix,
        },
      };
    }
  } else {
    writeRepoConfig(paths.configPath, input.taskPrefix);
    created.push(".but-why/config.json");
  }

  const stateChange = ensureStateDatabase(paths.statePath);

  if (stateChange === "created") {
    created.push(".but-why/state.sqlite");
  } else if (stateChange === "updated") {
    updated.push(".but-why/state.sqlite");
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

  const status = wasInitialized
    ? created.length > 0 || updated.length > 0
      ? "repaired"
      : "unchanged"
    : "initialized";

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

  const paths = repoLocalPaths(gitRoot.root);

  if (!existsSync(paths.configPath)) {
    return { ok: false, error: { code: "not_initialized" } };
  }

  const repoConfig = readRepoConfig(paths.configPath);

  if (!repoConfig.ok || !isValidTaskPrefix(repoConfig.config.taskPrefix)) {
    return { ok: false, error: { code: "invalid_repo_config" } };
  }

  return {
    ok: true,
    context: {
      root: gitRoot.root,
      paths,
      taskPrefix: repoConfig.config.taskPrefix,
      config: repoConfig.config,
    },
  };
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
