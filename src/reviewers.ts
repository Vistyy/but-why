import { Data, Effect } from "effect";

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

/** The adapter failed to prove that its underlying activity stopped. */
export class ReviewerActivityUncertain extends Data.TaggedError("ReviewerActivityUncertain")<{
  readonly message: string;
}> {}

const DEADLINE_MS = 120_000;

const SETTLE_MS = 2_000;

type ActivityFailure = ReviewFailure | { readonly _tag: "TimeoutError" };

function interrupted(signal: AbortSignal): Effect.Effect<never, ReviewFailure> {
  return Effect.callback((resume) => {
    const fail = () => resume(Effect.fail({ _tag: "ReviewerInterrupted" }));

    if (signal.aborted) {
      fail();

      return Effect.void;
    }

    signal.addEventListener("abort", fail, { once: true });

    return Effect.sync(() => signal.removeEventListener("abort", fail));
  });
}

function failedReview(
  rule: RuleAssignment,
  error: ActivityFailure,
  finished: () => boolean,
  settle: number,
  markUncertain: () => void,
): Effect.Effect<ReviewOutcome> {
  return Effect.gen(function* () {
    if (!finished()) {
      yield* Effect.sleep(settle);

      if (!finished()) markUncertain();
    }

    if (error._tag === "ReviewerFailed" && error.cause instanceof ReviewerActivityUncertain)
      markUncertain();

    const failure: ReviewFailure =
      error._tag === "TimeoutError" ? { _tag: "ReviewerTimedOut" } : error;

    return { ...rule, output: null, failure };
  });
}

function reviewOne(
  rule: RuleAssignment,
  cwd: string,
  reviewer: Reviewer,
  signal: AbortSignal | undefined,
  deadline: number,
  settle: number,
  markUncertain: () => void,
): Effect.Effect<ReviewOutcome> {
  return Effect.gen(function* () {
    if (signal?.aborted === true)
      return { ...rule, output: null, failure: { _tag: "ReviewerInterrupted" } };

    let finished = false;

    const activity = Effect.tryPromise({
      try: (reviewSignal) =>
        Promise.resolve()
          .then(() => reviewer({ cwd, prompt: rule.prompt, signal: reviewSignal }))
          .then(
            (text) => {
              finished = true;

              return text;
            },
            (cause: unknown) => {
              finished = true;

              throw cause;
            },
          ),
      catch: (cause): ReviewFailure => ({ _tag: "ReviewerFailed", cause }),
    });

    const observed =
      signal === undefined ? activity : Effect.raceFirst(activity, interrupted(signal));

    const outcome = yield* Effect.result(Effect.timeout(observed, deadline));

    if (outcome._tag === "Failure")
      return yield* failedReview(rule, outcome.failure, () => finished, settle, markUncertain);

    const output = outcome.success;

    return output.trim().length > 0
      ? { ...rule, output, failure: null }
      : { ...rule, output: null, failure: { _tag: "EmptyReview" } };
  });
}

// Effect owns the reviewer AbortSignal and deadline. Bounded observation after
// interruption determines whether checkout cleanup is safe.
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

  const markUncertain = () => {
    uncertain = true;
  };

  return Effect.forEach(
    rules,
    (rule) => reviewOne(rule, cwd, reviewer, signal, deadline, settle, markUncertain),
    { concurrency: 3 },
  ).pipe(Effect.map((results) => ({ results, uncertain })));
}
