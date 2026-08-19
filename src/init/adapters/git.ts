import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

export type GitRootResult =
  | {
      readonly ok: true;
      readonly root: string;
      readonly commonDirectory: string;
    }
  | {
      readonly ok: false;
      readonly code: "not_initialized";
    };

export type CurrentWorktreeFacts = {
  readonly worktreePath: string;
  readonly branchRef: string;
};

export const findCurrentWorktreeFacts = (
  cwd: string,
): ({ readonly ok: true } & CurrentWorktreeFacts) | { readonly ok: false } => {
  const root = findGitRoot(cwd);
  if (!root.ok) return { ok: false };

  const branch = spawnSync("git", ["rev-parse", "--symbolic-full-name", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const branchRef = branch.stdout.trim();
  if (branch.status !== 0 || branchRef.length === 0) return { ok: false };

  try {
    return {
      ok: true,
      worktreePath: realpathSync(root.root),
      branchRef,
    };
  } catch {
    return { ok: false };
  }
};

export const findGitRoot = (cwd: string): GitRootResult => {
  const result = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  if (result.status !== 0) {
    return { ok: false, code: "not_initialized" };
  }

  const [root, commonDirectory] = result.stdout.trim().split("\n");

  if (
    root === undefined ||
    root.length === 0 ||
    commonDirectory === undefined ||
    commonDirectory.length === 0
  ) {
    return { ok: false, code: "not_initialized" };
  }

  return {
    ok: true,
    root: realpathSync(root),
    commonDirectory: realpathSync(commonDirectory),
  };
};
