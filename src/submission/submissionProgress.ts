import { Clock, Effect } from "effect";

export type SubmitProgressProfile = {
  readonly name: string;
  readonly model: string;
  readonly thinking: string;
};

export type SubmitProgressPhase =
  | { readonly kind: "repositoryPreparation" }
  | { readonly kind: "taskReview"; readonly profile: SubmitProgressProfile }
  | { readonly kind: "prepare" }
  | { readonly kind: "check"; readonly id: string }
  | { readonly kind: "acceptance"; readonly profile: SubmitProgressProfile }
  | {
      readonly kind: "specialist";
      readonly id: string;
      readonly profile: SubmitProgressProfile;
    };

export type SubmitProgressCompletion = {
  readonly reason?: "findings" | "tooling";
};

export type SubmitProgress = {
  readonly started: (phase: SubmitProgressPhase) => void;
  readonly completed: (
    phase: SubmitProgressPhase,
    outcome: "passed" | "failed",
    durationMs: number,
    details?: SubmitProgressCompletion,
  ) => void;
};

export type StartedSubmitProgress = {
  readonly phase: SubmitProgressPhase;
  readonly startedAt: number;
};

export const stderrSubmitProgress = (writeStderr: (message: string) => void): SubmitProgress => {
  const write = (message: string): void => {
    try {
      writeStderr(message);
    } catch {
      // Progress must not change the structured Submit result.
    }
  };
  return {
    started: (phase) => write(`${startLabel(phase)}\n`),
    completed: (phase, outcome, durationMs, details) =>
      write(
        `${completionLabel(phase)} ${outcome} in ${formatDuration(durationMs)}${formatCompletionDetails(details)}\n`,
      ),
  };
};

export const startSubmitProgress = (
  progress: SubmitProgress | undefined,
  phase: SubmitProgressPhase,
): Effect.Effect<StartedSubmitProgress | undefined> =>
  Effect.gen(function* () {
    if (progress === undefined) return undefined;
    const startedAt = yield* Clock.currentTimeMillis;
    progress.started(phase);
    return { phase, startedAt };
  });

export const runAfterSubmitProgressStarted = <A, E, R>(input: {
  readonly progress: SubmitProgress | undefined;
  readonly started: () => StartedSubmitProgress | undefined;
  readonly run: Effect.Effect<A, E, R>;
  readonly outcome: (result: A) => "passed" | "failed";
  readonly details?: (result: A) => SubmitProgressCompletion | undefined;
  readonly failureDetails?: () => SubmitProgressCompletion | undefined;
}): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(input.run);
    const started = input.started();
    if (input.progress !== undefined && started !== undefined) {
      const durationMs = (yield* Clock.currentTimeMillis) - started.startedAt;
      input.progress.completed(
        started.phase,
        result._tag === "Success" ? input.outcome(result.value) : "failed",
        durationMs,
        result._tag === "Success" ? input.details?.(result.value) : input.failureDetails?.(),
      );
    }
    if (result._tag === "Failure") return yield* Effect.failCause(result.cause);
    return result.value;
  }) as Effect.Effect<A, E, R>;

export const runWithSubmitProgress = <A, E, R>(input: {
  readonly progress: SubmitProgress | undefined;
  readonly phase: SubmitProgressPhase;
  readonly run: Effect.Effect<A, E, R>;
  readonly outcome: (result: A) => "passed" | "failed";
  readonly details?: (result: A) => SubmitProgressCompletion | undefined;
}): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const started = yield* startSubmitProgress(input.progress, input.phase);
    return yield* runAfterSubmitProgressStarted({ ...input, started: () => started });
  });

const startLabel = (phase: SubmitProgressPhase): string => {
  switch (phase.kind) {
    case "repositoryPreparation":
      return "Repository Preparation started";
    case "taskReview":
      return `Task Review started: ${profileFacts(phase.profile)}`;
    case "prepare":
      return "Prepare started";
    case "check":
      return `Check started: ${phase.id}`;
    case "acceptance":
      return `Acceptance Review started: ${profileFacts(phase.profile)}`;
    case "specialist":
      return `Specialist Review started: ${phase.id} ${profileFacts(phase.profile)}`;
  }
};

const completionLabel = (phase: SubmitProgressPhase): string => {
  switch (phase.kind) {
    case "repositoryPreparation":
      return "Repository Preparation";
    case "taskReview":
      return "Task Review";
    case "prepare":
      return "Prepare";
    case "check":
      return `Check ${phase.id}`;
    case "acceptance":
      return "Acceptance Review";
    case "specialist":
      return `Specialist Review ${phase.id}`;
  }
};

const profileFacts = (profile: SubmitProgressProfile): string =>
  `profile=${profile.name} model=${profile.model} thinking=${profile.thinking}`;

const formatCompletionDetails = (details: SubmitProgressCompletion | undefined): string => {
  if (details === undefined) return "";
  const facts = details.reason === undefined ? [] : [`reason=${details.reason}`];
  return facts.length === 0 ? "" : ` ${facts.join(" ")}`;
};

const formatDuration = (durationMs: number): string => {
  let seconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  seconds -= hours * 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  return `${hours > 0 ? `${hours}h` : ""}${minutes > 0 ? `${minutes}m` : ""}${seconds}s`;
};
