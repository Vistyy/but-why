import { Effect } from "effect";
import { executeHostCommandEffect } from "../../../command/hostCommand.js";
import type { TaskReviewBase } from "../taskReview.js";

export const verifyRecordedTaskReviewBase = (
  mainCheckoutRoot: string,
  recorded: TaskReviewBase,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly message: string }> =>
  Effect.gen(function* () {
    const currentRef = yield* git(mainCheckoutRoot, "symbolic-ref", "-q", "HEAD");
    if (!currentRef.ok || currentRef.stdout !== recorded.ref) {
      return {
        ok: false,
        message: "Recorded Task Review Base ref does not match the canonical main checkout branch.",
      } as const;
    }
    if (!/^[0-9a-f]{40}$/u.test(recorded.commit)) {
      return {
        ok: false,
        message: "Recorded Task Review Base commit is not an exact commit ID.",
      } as const;
    }
    const commit = yield* git(
      mainCheckoutRoot,
      "rev-parse",
      "--verify",
      `${recorded.commit}^{commit}`,
    );
    if (!commit.ok || commit.stdout !== recorded.commit) {
      return {
        ok: false,
        message: "Recorded Task Review Base commit is unavailable in the Local Repository.",
      } as const;
    }
    return { ok: true } as const;
  });

export const readCanonicalMainReviewBase = (
  mainCheckoutRoot: string,
): Effect.Effect<
  | { readonly ok: true; readonly base: TaskReviewBase }
  | { readonly ok: false; readonly message: string }
> =>
  Effect.gen(function* () {
    const ref = yield* git(mainCheckoutRoot, "symbolic-ref", "-q", "HEAD");
    const commit = yield* git(mainCheckoutRoot, "rev-parse", "--verify", "HEAD^{commit}");
    if (!ref.ok || !commit.ok) {
      return {
        ok: false,
        message: "Could not resolve the canonical main checkout branch and commit.",
      } as const;
    }
    return { ok: true, base: { ref: ref.stdout, commit: commit.stdout } } as const;
  });

const git = (
  cwd: string,
  ...args: readonly string[]
): Effect.Effect<{ readonly ok: true; readonly stdout: string } | { readonly ok: false }> =>
  executeHostCommandEffect({ command: "git", args, cwd }).pipe(
    Effect.map((result) =>
      result.exitCode === 0
        ? ({ ok: true, stdout: result.stdout.trim() } as const)
        : ({ ok: false } as const),
    ),
    Effect.orElseSucceed(() => ({ ok: false }) as const),
  );
