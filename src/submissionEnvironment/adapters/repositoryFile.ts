import { spawnSync } from "node:child_process";

export type RepositoryFileReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false };

export const readRepositoryFileAtCommit = (
  cwd: string,
  commit: string,
  path: string,
): RepositoryFileReadResult => {
  const entry = spawnSync("git", ["ls-tree", "-z", commit, "--", path], {
    cwd,
    encoding: "utf8",
  });
  const separator = entry.stdout.indexOf("\t");
  const mode = separator < 0 ? undefined : entry.stdout.slice(0, separator).split(" ", 1)[0];
  if (entry.status !== 0 || (mode !== "100644" && mode !== "100755")) return { ok: false };

  const result = spawnSync("git", ["show", `${commit}:${path}`], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? { ok: true, content: result.stdout } : { ok: false };
};
