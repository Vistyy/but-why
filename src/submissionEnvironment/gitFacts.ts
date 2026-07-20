import { spawnSync } from "node:child_process";

export type GitCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false };

export type GitCommandRunner = (args: readonly string[], cwd: string) => GitCommandResult;

export const runGitCommand: GitCommandRunner = (args, cwd) => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  return result.status === 0 ? { ok: true, stdout: result.stdout } : { ok: false };
};
