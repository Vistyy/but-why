import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { prepareStateDatabaseSession } from "../../src/init/stateDatabase.js";
import { createInitializedRepo } from "./initializedRepo.js";

export const candidateReadyRepo = (): string => {
  const root = createInitializedRepo();
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  git(root, "checkout", "-b", "main");
  git(root, "commit", "--allow-empty", "-m", "main");
  git(root, "remote", "add", "origin", "https://example.com/origin.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(root, "add", ".gitignore", ".but-why/config.json");
  git(root, "commit", "-m", "initialize but why");
  git(root, "checkout", "-b", "feature");
  git(root, "commit", "--allow-empty", "-m", "feature");
  return root;
};

export const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

export const commonDirectory = (root: string): string =>
  git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");

export const candidateSqliteInput = (root: string) =>
  prepareStateDatabaseSession({
    statePath: join(commonDirectory(root), "but-why", "state.sqlite"),
  });
