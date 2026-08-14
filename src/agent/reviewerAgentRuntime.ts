import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";
import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import type { AgentEnvironmentCommand } from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import type {
  ReviewerProcessExecutor,
  ReviewerProcessInput,
  ReviewerProcessResult,
} from "./reviewerExecution.js";
import { ReviewerProcessExecutionFailed } from "./reviewerExecution.js";
import { parseTaggedReviewerOutput } from "./reviewerOutputWire.js";
import type { TokenUsage } from "./tokenUsage.js";

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
  readonly sessionId?: string;
  readonly resumeSession?: string;
  readonly singleInvocation?: boolean;
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
    let sessionSnapshotSettled = false;
    const restoreSession = () => {
      if (sessionSnapshotSettled) return;
      if (sessionSnapshot !== undefined) restoreSessionRoot(sessionSnapshot);
      cleanupSessionSnapshot(sessionSnapshot);
      sessionSnapshotSettled = true;
    };
    const retainSession = () => {
      if (sessionSnapshotSettled) return;
      cleanupSessionSnapshot(sessionSnapshot);
      sessionSnapshotSettled = true;
    };
    const review = Effect.gen(function* () {
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
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        ...(input.resumeSession === undefined ? {} : { resumeSession: input.resumeSession }),
      };
      const initial = yield* Effect.either(
        runReviewerProcess(input.reviewerExecutor, processInput),
      );
      if (initial._tag === "Left") {
        restoreSession();
        return reviewerProcessFailure(initial.left, 1, "", [null]);
      }
      let current = initial.right;
      const invocationUsage: (TokenUsage | null)[] = [current.invocationUsage ?? null];
      let validation = yield* Effect.either(validateRunResult(input, current));
      if (validation._tag === "Right") {
        retainSession();
        return successfulResult(validation.right, current, 1, invocationUsage);
      }

      if (input.singleInvocation === true) {
        retainSession();
        return failedOutputResult(validation.left, current, 1, invocationUsage);
      }

      let attempts = 1;
      while (validation._tag === "Left" && attempts < 3) {
        const failure = validation.left;
        if (current.resume === undefined) {
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
        retainSession();
        return successfulResult(validation.right, current, attempts, invocationUsage);
      }
      restoreSession();
      return failedOutputResult(validation.left, current, attempts, invocationUsage);
    });

    return yield* review.pipe(Effect.ensuring(Effect.sync(restoreSession)));
  });

export const piReviewerAgentRuntime = {
  review: reviewWithPi,
};

const successfulResult = <Output>(
  report: Output,
  processResult: ReviewerProcessResult,
  attempts: number,
  invocationUsage: readonly (TokenUsage | null)[],
): ReviewerAgentResult<Output> => ({
  ok: true,
  report,
  attempts,
  stdout: processResult.stdout,
  invocationUsage,
  ...processMetadata(processResult),
});

const failedOutputResult = (
  failure: ReviewerExecutionFailed,
  processResult: ReviewerProcessResult,
  attempts: number,
  invocationUsage: readonly (TokenUsage | null)[],
): ReviewerAgentResult<never> => ({
  ok: false,
  failure,
  sessionUsability: "unknown",
  attempts,
  stdout: processResult.stdout,
  invocationUsage,
  ...processMetadata(processResult),
});

const validateRunResult = <Output>(
  input: ReviewerAgentInput<Output>,
  result: ReviewerProcessResult,
) => input.decodeOutput(parseTaggedReviewerOutput(result.stdout));

const runReviewerProcess = (
  executor: ReviewerProcessExecutor,
  input: ReviewerProcessInput,
): Effect.Effect<ReviewerProcessResult, ReviewerExecutionFailed> =>
  translateProcessFailure(executor.execute(input));

const resumeReviewerProcess = (
  result: ReviewerProcessResult,
  prompt: string,
): Effect.Effect<ReviewerProcessResult, ReviewerExecutionFailed> =>
  translateProcessFailure(
    result.resume?.(prompt) ??
      Effect.fail(
        new ReviewerProcessExecutionFailed({
          message: "Reviewer continuation is unavailable.",
          sessionUsability: "unknown",
        }),
      ),
  );

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
