import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";
import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import type { TokenUsage } from "../contracts/tokenUsage.js";
import type { AgentEnvironmentCommand } from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import type {
  ReviewerProcessExecutor,
  ReviewerProcessInput,
  ReviewerProcessResult,
} from "./reviewerExecution.js";
import { ReviewerProcessExecutionFailed } from "./reviewerExecution.js";
import { parseTaggedReviewerOutput } from "./reviewerOutputWire.js";

export class ReviewerExecutionFailed extends Data.TaggedError("ReviewerExecutionFailed")<{
  readonly kind: "process_execution" | "output_contract";
  readonly operationName: string;
  readonly message: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
  readonly correctionPrompt?: string;
  readonly sessionUsability?: ReviewerSessionUsability;
}> {}

export type ReviewerOutputDecoder<Output> = (
  output: unknown,
) => Effect.Effect<Output, ReviewerExecutionFailed>;

export type ReviewerRuntimeFailure = {
  readonly kind: "process_execution" | "output_contract";
  readonly operationName: string;
  readonly message: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
  readonly correctionPrompt?: string;
  readonly sessionUsability?: ReviewerSessionUsability;
};

export type ReviewerAgentRuntime<Output = unknown> = {
  readonly review: (
    input: ReviewerAgentInput<Output>,
  ) => Effect.Effect<ReviewerAgentResult<Output>>;
};

export type ReviewerSessionUsability = "unusable" | "unknown";

export type ReviewerAgentInput<Output> = {
  readonly reviewerExecutor: ReviewerProcessExecutor;
  readonly reviewer: string;
  readonly decodeOutput: ReviewerOutputDecoder<Output>;
  readonly prompt: string;
  readonly profile: ResolvedPiAgentProfile;
  readonly commandCwd?: string;
  readonly resourceRoot?: string;
  readonly agentEnvironment?: AgentEnvironmentCommand;
  readonly sessionStorageRoot?: string;
  readonly resumeSession?: string;
};

export type ReviewerAgentResult<Output = unknown> =
  | {
      readonly ok: true;
      readonly report: Output;
      readonly attempts: number;
      readonly stdout: string;
      readonly invocationUsage?: readonly (TokenUsage | null)[];
      readonly sessionReference?: string;
      readonly sessionFilePath?: string;
    }
  | {
      readonly ok: false;
      readonly failure: ReviewerRuntimeFailure;
      readonly sessionUsability: ReviewerSessionUsability;
      readonly attempts: number;
      readonly stdout: string;
      readonly invocationUsage?: readonly (TokenUsage | null)[];
      readonly sessionReference?: string;
      readonly sessionFilePath?: string;
    };

const reviewWithPi = <Output>(
  input: ReviewerAgentInput<Output>,
): Effect.Effect<ReviewerAgentResult<Output>> =>
  Effect.gen(function* () {
    const sessionSnapshot =
      input.resumeSession === undefined || input.sessionStorageRoot === undefined
        ? undefined
        : snapshotSessionRoot(input.sessionStorageRoot);
    const restoreSession = () => {
      if (sessionSnapshot !== undefined) restoreSessionRoot(sessionSnapshot);
      cleanupSessionSnapshot(sessionSnapshot);
    };
    const processInput: ReviewerProcessInput = {
      reviewer: input.reviewer,
      prompt: input.prompt,
      profile: input.profile,
      commandCwd: input.commandCwd ?? input.resourceRoot ?? ".",
      resourceRoot: input.resourceRoot ?? input.commandCwd ?? ".",
      ...(input.agentEnvironment === undefined
        ? {}
        : { agentEnvironment: input.agentEnvironment }),
      ...(input.sessionStorageRoot === undefined
        ? {}
        : { sessionStorageRoot: input.sessionStorageRoot }),
      ...(input.resumeSession === undefined ? {} : { resumeSession: input.resumeSession }),
    };
    const initial = yield* Effect.either(runReviewerProcess(input.reviewerExecutor, processInput));
    if (initial._tag === "Left") {
      restoreSession();
      return reviewerProcessFailure(initial.left, 1, "", [null]);
    }
    let current = initial.right;
    const invocationUsage: (TokenUsage | null)[] = [current.invocationUsage ?? null];
    let validation = yield* Effect.either(validateRunResult(input, current));
    if (validation._tag === "Right") {
      cleanupSessionSnapshot(sessionSnapshot);
      return successfulResult(validation.right, current, 1, invocationUsage);
    }

    let attempts = 1;
    while (validation._tag === "Left" && attempts < 3) {
      const failure = validation.left;
      if (current.resume === undefined && current.resumeEffect === undefined) {
        restoreSession();
        return failedOutputResult(failure, current, attempts, invocationUsage);
      }
      attempts += 1;
      const corrected = yield* Effect.either(
        resumeReviewerProcess(current, failure.correctionPrompt ?? failure.message),
      );
      if (corrected._tag === "Left") {
        restoreSession();
        return reviewerProcessFailure(corrected.left, attempts, current.stdout, [
          ...invocationUsage,
          null,
        ]);
      }
      current = corrected.right;
      invocationUsage.push(current.invocationUsage ?? null);
      validation = yield* Effect.either(validateRunResult(input, current));
    }

    if (validation._tag === "Right") {
      cleanupSessionSnapshot(sessionSnapshot);
      return successfulResult(validation.right, current, attempts, invocationUsage);
    }
    restoreSession();
    return failedOutputResult(validation.left, current, attempts, invocationUsage);
  });

export const piReviewerAgentRuntime = {
  review: reviewWithPi,
};

const successfulResult = <Output>(
  report: Output,
  process: ReviewerProcessResult,
  attempts: number,
  invocationUsage: readonly (TokenUsage | null)[],
): ReviewerAgentResult<Output> => ({
  ok: true,
  report,
  attempts,
  stdout: process.stdout,
  invocationUsage,
  ...processMetadata(process),
});

const failedOutputResult = (
  failure: ReviewerExecutionFailed,
  process: ReviewerProcessResult,
  attempts: number,
  invocationUsage: readonly (TokenUsage | null)[],
): ReviewerAgentResult<never> => ({
  ok: false,
  failure,
  sessionUsability: "unknown",
  attempts,
  stdout: process.stdout,
  invocationUsage,
  ...processMetadata(process),
});

const validateRunResult = <Output>(
  input: ReviewerAgentInput<Output>,
  result: ReviewerProcessResult,
) => input.decodeOutput(parseTaggedReviewerOutput(result.stdout));

const runReviewerProcess = (
  executor: ReviewerProcessExecutor,
  input: ReviewerProcessInput,
): Effect.Effect<ReviewerProcessResult, ReviewerExecutionFailed> =>
  translateProcessFailure(
    executor.effect === undefined
      ? Effect.tryPromise({
          try: () => executor.execute(input),
          catch: (error) => reviewerProcessExecutionFailed(error),
        })
      : executor.effect(input),
  );

const resumeReviewerProcess = (
  result: ReviewerProcessResult,
  prompt: string,
): Effect.Effect<ReviewerProcessResult, ReviewerExecutionFailed> => {
  const resumed =
    result.resumeEffect !== undefined
      ? result.resumeEffect(prompt)
      : Effect.tryPromise({
          try: () => {
            if (result.resume === undefined) throw new Error("Reviewer continuation is unavailable.");
            return result.resume(prompt);
          },
          catch: (error) => reviewerProcessExecutionFailed(error),
        });
  return translateProcessFailure(resumed);
};

const translateProcessFailure = (
  effect: Effect.Effect<ReviewerProcessResult, ReviewerProcessExecutionFailed>,
): Effect.Effect<ReviewerProcessResult, ReviewerExecutionFailed> =>
  effect.pipe(
    Effect.mapError(
      (error) =>
        new ReviewerExecutionFailed({
          operationName: "run_reviewer_process",
          message: error.message,
          kind: "process_execution",
          sessionUsability: error.sessionUsability,
        }),
    ),
  );

const reviewerProcessExecutionFailed = (error: unknown): ReviewerProcessExecutionFailed =>
  error instanceof ReviewerProcessExecutionFailed
    ? error
    : new ReviewerProcessExecutionFailed({ message: errorMessage(error), sessionUsability: "unknown" });

const reviewerProcessFailure = (
  failure: ReviewerExecutionFailed,
  attempts: number,
  stdout: string,
  invocationUsage: readonly (TokenUsage | null)[],
): ReviewerAgentResult<never> => ({
  ok: false,
  failure,
  sessionUsability: failure.sessionUsability ?? "unknown",
  attempts,
  stdout,
  invocationUsage,
});

const snapshotSessionRoot = (
  root: string,
): { readonly root: string; readonly snapshot: string } | undefined => {
  if (!existsSync(root)) return undefined;
  const snapshot = mkdtempSync(join(tmpdir(), "but-why-reviewer-session-"));
  cpSync(root, join(snapshot, "sessions"), { recursive: true });
  return { root, snapshot };
};

const cleanupSessionSnapshot = (
  value: { readonly root: string; readonly snapshot: string } | undefined,
): void => {
  if (value !== undefined) rmSync(value.snapshot, { recursive: true, force: true });
};

const restoreSessionRoot = (value: { readonly root: string; readonly snapshot: string }): void => {
  const source = join(value.snapshot, "sessions");
  rmSync(value.root, { recursive: true, force: true });
  cpSync(source, value.root, { recursive: true });
};

const processMetadata = (
  result: ReviewerProcessResult,
): { readonly sessionReference?: string; readonly sessionFilePath?: string } => ({
  ...(result.sessionReference === undefined ? {} : { sessionReference: result.sessionReference }),
  ...(result.sessionFilePath === undefined ? {} : { sessionFilePath: result.sessionFilePath }),
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
