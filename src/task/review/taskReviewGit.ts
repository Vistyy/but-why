import { spawnSync } from "node:child_process";

export type TaskReviewBase = { readonly ref: string; readonly commit: string };

export const readCanonicalMainReviewBase = (
  mainCheckoutRoot: string,
):
  | { readonly ok: true; readonly base: TaskReviewBase }
  | { readonly ok: false; readonly message: string } => {
  const ref = git(mainCheckoutRoot, "symbolic-ref", "-q", "HEAD");
  const commit = git(mainCheckoutRoot, "rev-parse", "--verify", "HEAD^{commit}");
  if (!ref.ok || !commit.ok) {
    return {
      ok: false,
      message: "Could not resolve the canonical main checkout branch and commit.",
    };
  }
  return { ok: true, base: { ref: ref.stdout, commit: commit.stdout } };
};

const git = (
  cwd: string,
  ...args: readonly string[]
): { readonly ok: true; readonly stdout: string } | { readonly ok: false } => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 ? { ok: true, stdout: result.stdout.trim() } : { ok: false };
};
