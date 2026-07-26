import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

export type GitRootResult =
  | {
      readonly ok: true;
      readonly root: string;
      readonly mainCheckoutRoot: string;
      readonly commonDirectory: string;
    }
  | {
      readonly ok: false;
      readonly code: "not_initialized";
    }
  | {
      readonly ok: false;
      readonly code: "main_checkout_unavailable";
      readonly path?: string;
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

  const worktrees = spawnSync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (worktrees.status !== 0) return { ok: false, code: "main_checkout_unavailable" };
  const mainWorktree = worktrees.stdout.split("\0\0", 1)[0];
  const mainCheckoutRoot = mainWorktree
    ?.split("\0")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  if (
    mainCheckoutRoot === undefined ||
    mainCheckoutRoot.length === 0 ||
    mainWorktree?.split("\0").includes("bare") === true
  ) {
    return { ok: false, code: "main_checkout_unavailable" };
  }

  let resolvedMainCheckoutRoot: string;
  try {
    resolvedMainCheckoutRoot = realpathSync(mainCheckoutRoot);
  } catch {
    return { ok: false, code: "main_checkout_unavailable", path: mainCheckoutRoot };
  }

  return {
    ok: true,
    root,
    mainCheckoutRoot: resolvedMainCheckoutRoot,
    commonDirectory: realpathSync(commonDirectory),
  };
};
