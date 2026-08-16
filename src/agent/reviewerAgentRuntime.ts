import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Data, Effect } from "effect";
import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import type { AgentEnvironmentCommand } from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import type {
  ReviewerProcessExecutionFailed,
  ReviewerProcessExecutor,
  ReviewerProcessInput,
  ReviewerProcessResult,
} from "./reviewerExecution.js";
import { parseTaggedReviewerOutput } from "./reviewerOutputWire.js";
import type { TokenUsage } from "./tokenUsage.js";

export class ReviewerExecutionFailed extends Data.TaggedError("ReviewerExecutionFailed")<{
  readonly kind: "process_execution" | "output_contract";
  readonly operationName: string;
  readonly message: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
  readonly correctionPrompt?: string;
  readonly sessionUsability?: ReviewerSessionUsability;
  readonly invocationUsage?: TokenUsage | null;
  readonly sessionReference?: string;
  readonly sessionFilePath?: string;
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
  readonly invocationUsage?: TokenUsage | null;
  readonly sessionReference?: string;
  readonly sessionFilePath?: string;
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
  /** The exact persisted continuation file used for narrow interruption recovery. */
  readonly continuationFilePath?: string;
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
      input.resumeSession === undefined || input.continuationFilePath === undefined
        ? undefined
        : snapshotContinuationFile(input.continuationFilePath);
    let sessionSnapshotSettled = false;
    const restoreSession = () => {
      if (sessionSnapshotSettled) return;
      if (sessionSnapshot !== undefined) restoreContinuationFile(sessionSnapshot);
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
        return reviewerProcessFailure(initial.left, 1, "");
      }
      const invocationUsage: readonly (TokenUsage | null)[] = [
        initial.right.invocationUsage ?? null,
      ];
      const validation = yield* Effect.either(validateRunResult(input, initial.right));
      if (validation._tag === "Right") {
        sessionSnapshotSettled = true;
        return successfulResult(validation.right, initial.right, 1, invocationUsage);
      }
      sessionSnapshotSettled = true;
      return failedOutputResult(validation.left, initial.right, 1, invocationUsage);
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
          ...(error.invocationUsage === undefined
            ? {}
            : { invocationUsage: error.invocationUsage }),
          ...(error.sessionReference === undefined
            ? {}
            : { sessionReference: error.sessionReference }),
          ...(error.sessionFilePath === undefined
            ? {}
            : { sessionFilePath: error.sessionFilePath }),
        }),
    ),
  );

const reviewerProcessFailure = (
  failure: ReviewerExecutionFailed,
  attempts: number,
  stdout: string,
): ReviewerAgentResult<never> => ({
  ok: false,
  failure,
  sessionUsability: failure.sessionUsability ?? "unknown",
  attempts,
  stdout,
  invocationUsage: [failure.invocationUsage ?? null],
  ...(failure.sessionReference === undefined ? {} : { sessionReference: failure.sessionReference }),
  ...(failure.sessionFilePath === undefined ? {} : { sessionFilePath: failure.sessionFilePath }),
});

type ContinuationFileSnapshot = {
  readonly path: string;
  readonly contents: string;
  readonly mode: number;
};

const snapshotContinuationFile = (path: string): ContinuationFileSnapshot | undefined => {
  if (!existsSync(path)) return undefined;
  return {
    path,
    contents: readFileSync(path, "utf8"),
    mode: statSync(path).mode,
  };
};

const restoreContinuationFile = (snapshot: ContinuationFileSnapshot): void => {
  writeFileSync(snapshot.path, snapshot.contents, { mode: snapshot.mode & 0o777 });
  chmodSync(snapshot.path, snapshot.mode & 0o777);
};

const processMetadata = (
  result: ReviewerProcessResult,
): { readonly sessionReference?: string; readonly sessionFilePath?: string } => ({
  ...(result.sessionReference === undefined ? {} : { sessionReference: result.sessionReference }),
  ...(result.sessionFilePath === undefined ? {} : { sessionFilePath: result.sessionFilePath }),
});
