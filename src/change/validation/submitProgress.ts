import { Clock, Effect } from "effect";

export type SubmitProgressProfile = {
  readonly name: string;
  readonly model: string;
  readonly thinking: string;
};

export type SubmitProgressPhase =
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
  readonly continuity?: "fresh" | "resumed" | "restarted";
  readonly reviewCalls?: number;
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

export const runWithSubmitProgress = <A, E, R>(input: {
  readonly progress: SubmitProgress | undefined;
  readonly phase: SubmitProgressPhase;
  readonly run: Effect.Effect<A, E, R>;
  readonly outcome: (result: A) => "passed" | "failed";
  readonly details?: (result: A) => SubmitProgressCompletion | undefined;
}): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    input.progress?.started(input.phase);
    const result = yield* Effect.exit(input.run);
    const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
    input.progress?.completed(
      input.phase,
      result._tag === "Success" ? input.outcome(result.value) : "failed",
      durationMs,
      result._tag === "Success" ? input.details?.(result.value) : undefined,
    );
    if (result._tag === "Failure") return yield* Effect.failCause(result.cause);
    return result.value;
  }) as Effect.Effect<A, E, R>;

const startLabel = (phase: SubmitProgressPhase): string => {
  switch (phase.kind) {
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
  const facts = [
    ...(details.reason === undefined ? [] : [`reason=${details.reason}`]),
    ...(details.continuity === undefined ? [] : [`continuity=${details.continuity}`]),
    ...(details.reviewCalls === undefined ? [] : [`reviewCalls=${details.reviewCalls}`]),
  ];
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
