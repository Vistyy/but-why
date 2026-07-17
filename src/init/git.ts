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
  const root = gitPath(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
  const commonDirectory = gitPath(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

  if (root === undefined || commonDirectory === undefined) {
    return { ok: false };
  }

  return { ok: true, root, commonDirectory: realpathSync(commonDirectory) };
};

const gitPath = (cwd: string, args: readonly string[]): string | undefined => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const path = result.stdout.trim();

  return result.status === 0 && path.length > 0 ? path : undefined;
};
