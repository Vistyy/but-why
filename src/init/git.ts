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
    return { ok: false };
  }

  const [root, commonDirectory] = result.stdout.trim().split("\n");

  if (
    root === undefined ||
    root.length === 0 ||
    commonDirectory === undefined ||
    commonDirectory.length === 0
  ) {
    return { ok: false };
  }

  return { ok: true, root, commonDirectory: realpathSync(commonDirectory) };
};
