import { spawnSync } from "node:child_process";

export type RepositoryFileReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false };

export const readRepositoryFileAtCommit = (
  cwd: string,
  commit: string,
  path: string,
): RepositoryFileReadResult => {
  const result = spawnSync("git", ["show", `${commit}:${path}`], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? { ok: true, content: result.stdout } : { ok: false };
};
