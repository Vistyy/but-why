import { Effect } from "effect";

export type Reviewer = (input: {
  cwd: string;
  prompt: string;
  signal: AbortSignal;
}) => Promise<string>;

export type RuleAssignment = {
  identity: string;
  provenance: string;
  prompt: string;
};

export type ReviewFailure =
  | { readonly _tag: "ReviewerFailed"; readonly cause: unknown }
  | { readonly _tag: "ReviewerTimedOut" }
  | { readonly _tag: "ReviewerInterrupted" }
  | { readonly _tag: "EmptyReview" };

export type ReviewOutcome = RuleAssignment & {
  output: string | null;
  failure: ReviewFailure | null;
};

export type ReviewBatch = { results: ReviewOutcome[]; uncertain: boolean };

const DEADLINE_MS = 120_000;
const SETTLE_MS = 2_000;

// The reviewer is an external Promise boundary: Effect interruption aborts its signal,
// but does not prove that the underlying SDK activity has finished.
export function runReviewers(
  rules: readonly RuleAssignment[],
  cwd: string,
  reviewer: Reviewer,
  signal?: AbortSignal,
  options: { deadlineMs?: number; settleMs?: number } = {},
): Effect.Effect<ReviewBatch> {
  const deadline = options.deadlineMs ?? DEADLINE_MS;
  const settle = options.settleMs ?? SETTLE_MS;
  let uncertain = false;
  // Keep cancellation, timeout and bounded settlement in one scope so their races
  // share the same activity and uncertainty state.
  const runOne = (rule: RuleAssignment): Effect.Effect<ReviewOutcome, never, never> =>
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the explicit bounded cancellation state machine is intentional.
    Effect.gen(function* () {
      if (signal?.aborted)
        return { ...rule, output: null, failure: { _tag: "ReviewerInterrupted" } as const };
      let finished = false;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const onInterrupt = () => {
        controller.abort();
      };
      signal?.addEventListener("abort", onInterrupt, { once: true });
      const activity = Promise.resolve()
        .then(() => reviewer({ cwd, prompt: rule.prompt, signal: controller.signal }))
        .then(
          (text) => {
            finished = true;
            return text;
          },
          (error: unknown) => {
            finished = true;
            throw error;
          },
        );
      let rejectInterrupted: ((reason: Error) => void) | undefined;
      const interrupted = new Promise<string>((_, reject) => {
        rejectInterrupted = reject;
      });
      const interruptReviewer = () => rejectInterrupted?.(new Error("Reviewer interrupted"));
      try {
        signal?.addEventListener("abort", interruptReviewer, { once: true });
        if (signal?.aborted) interruptReviewer();
        const result = yield* Effect.result(
          Effect.timeout(
            Effect.tryPromise({
              try: (effectSignal) => {
                effectSignal.addEventListener("abort", abort, { once: true });
                return signal ? Promise.race([activity, interrupted]) : activity;
              },
              catch: (cause): ReviewFailure => ({ _tag: "ReviewerFailed", cause }),
            }),
            deadline,
          ),
        );
        if (result._tag === "Success") {
          const output = result.success;
          return output.trim().length
            ? { ...rule, output, failure: null }
            : { ...rule, output: null, failure: { _tag: "EmptyReview" } as const };
        }
        controller.abort();
        if (!finished) {
          yield* Effect.sleep(settle);
          if (!finished) uncertain = true;
        }
        const error = result.failure;
        if (
          typeof error === "object" &&
          error !== null &&
          "cause" in error &&
          typeof error.cause === "object" &&
          error.cause !== null &&
          "name" in error.cause &&
          error.cause.name === "ReviewerActivityUncertain"
        )
          uncertain = true;
        const failure: ReviewFailure = signal?.aborted
          ? { _tag: "ReviewerInterrupted" }
          : "_tag" in error && error._tag === "TimeoutError"
            ? { _tag: "ReviewerTimedOut" }
            : (error as ReviewFailure);
        return { ...rule, output: null, failure };
      } finally {
        signal?.removeEventListener("abort", onInterrupt);
        signal?.removeEventListener("abort", interruptReviewer);
        void activity.catch(() => undefined);
      }
    });
  return Effect.map(Effect.forEach(rules, runOne, { concurrency: 3 }), (results) => ({
    results,
    uncertain,
  }));
}
