import { spawnSync } from "node:child_process";

export type TaskReviewBase = { readonly ref: string; readonly commit: string };

export const verifyRecordedTaskReviewBase = (
  mainCheckoutRoot: string,
  recorded: TaskReviewBase,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  const currentRef = git(mainCheckoutRoot, "symbolic-ref", "-q", "HEAD");
  if (!currentRef.ok || currentRef.stdout !== recorded.ref) {
    return {
      ok: false,
      message: "Recorded Task Review Base ref does not match the canonical main checkout branch.",
    };
  }
  if (!/^[0-9a-f]{40}$/u.test(recorded.commit)) {
    return { ok: false, message: "Recorded Task Review Base commit is not an exact commit ID." };
  }
  const commit = git(mainCheckoutRoot, "rev-parse", "--verify", `${recorded.commit}^{commit}`);
  if (!commit.ok || commit.stdout !== recorded.commit) {
    return {
      ok: false,
      message: "Recorded Task Review Base commit is unavailable in the Local Repository.",
    };
  }
  return { ok: true };
};

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
