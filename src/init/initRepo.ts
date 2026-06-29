import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { findGitRoot } from "./git.js";
import { ensureGitignoreBlock } from "./gitignore.js";
import { readRepoConfig, writeRepoConfig } from "./repoConfig.js";
import { ensureStateDatabase } from "./stateDatabase.js";

export const taskPrefixPattern = /^[A-Z][A-Z0-9]{1,9}$/;

type InitRepoInput = {
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

export const initRepo = (input: InitRepoInput): InitRepoResult => {
  const gitRoot = findGitRoot(input.cwd);

  if (!gitRoot.ok) {
    return { ok: false, error: { code: "not_git_work_tree" } };
  }

  const root = gitRoot.root;
  const butWhyDir = join(root, ".but-why");
  const configPath = join(butWhyDir, "config.json");
  const statePath = join(butWhyDir, "state.sqlite");
  const reviewersPath = join(butWhyDir, "reviewers");
  const gitignorePath = join(root, ".gitignore");

  const wasInitialized = existsSync(configPath);
  const created: string[] = [];
  const updated: string[] = [];

  mkdirSync(butWhyDir, { recursive: true });

  if (wasInitialized) {
    const config = readRepoConfig(configPath);

    if (!config.ok || !taskPrefixPattern.test(config.config.taskPrefix)) {
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
    writeRepoConfig(configPath, input.taskPrefix);
    created.push(".but-why/config.json");
  }

  const stateChange = ensureStateDatabase(statePath);

  if (stateChange === "created") {
    created.push(".but-why/state.sqlite");
  } else if (stateChange === "updated") {
    updated.push(".but-why/state.sqlite");
  }

  if (!existsSync(reviewersPath)) {
    mkdirSync(reviewersPath, { recursive: true });
    created.push(".but-why/reviewers/");
  } else if (!statSync(reviewersPath).isDirectory()) {
    return {
      ok: false,
      error: {
        code: "invalid_repo_state",
        path: ".but-why/reviewers/",
        expected: "directory",
      },
    };
  }

  if (ensureGitignoreBlock(gitignorePath)) {
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
    root,
    taskPrefix: input.taskPrefix,
    created,
    updated,
  };
};
