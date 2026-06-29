import { spawnSync } from "node:child_process";

export type GitRootResult =
  | {
      readonly ok: true;
      readonly root: string;
    }
  | {
      readonly ok: false;
    };

export const findGitRoot = (cwd: string): GitRootResult => {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return { ok: false };
  }

  const root = result.stdout.trim();

  if (root.length === 0) {
    return { ok: false };
  }

  return { ok: true, root };
};
