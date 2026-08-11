import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";
import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import type { AgentEnvironmentCommand } from "./agentEnvironment.js";
import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import type { ReviewerProcessExecutor, ReviewerProcessResult } from "./reviewerExecution.js";
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
      readonly sessionReference?: string;
      readonly sessionFilePath?: string;
    }
  | {
      readonly ok: false;
      readonly failure: ReviewerRuntimeFailure;
      readonly sessionUsability: ReviewerSessionUsability;
      readonly attempts: number;
      readonly stdout: string;
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
    const resetSession = () => {
      if (sessionSnapshot !== undefined) restoreSessionRoot(sessionSnapshot);
    };
    const restoreSession = () => {
      resetSession();
      cleanupSessionSnapshot(sessionSnapshot);
    };
    const initial = yield* Effect.either(
      runReviewerProcess(() =>
        input.reviewerExecutor.execute({
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
          onSessionCaptureFailure: resetSession,
        }),
      ),
    );
    if (initial._tag === "Left") {
      restoreSession();
      return reviewerProcessFailure(initial.left, 1, "");
    }
    let current = initial.right;
    let validation = yield* Effect.either(validateRunResult(input, current, 1));
    if (validation._tag === "Right") {
      if (current.sessionCaptureUnavailable === true) restoreSession();
      else cleanupSessionSnapshot(sessionSnapshot);
      return {
        ok: true,
        report: validation.right,
        attempts: 1,
        stdout: current.stdout,
        ...processMetadata(current),
      };
    }
    let attempts = 1;
    while (validation._tag === "Left" && attempts < 3) {
      const failure = validation.left;
      const resume = current.resume;
      if (resume === undefined) {
        restoreSession();
        return {
          ok: false,
          failure,
          sessionUsability: "unknown",
          attempts,
          stdout: current.stdout,
          ...processMetadata(current),
        };
      }
      attempts += 1;
      const corrected = yield* Effect.either(
        runReviewerProcess(() => resume(failure.correctionPrompt ?? failure.message)),
      );
      if (corrected._tag === "Left") {
        restoreSession();
        return reviewerProcessFailure(corrected.left, attempts, current.stdout);
      }
      current = corrected.right;
      validation = yield* Effect.either(validateRunResult(input, current, attempts));
    }
    if (validation._tag === "Right") {
      if (current.sessionCaptureUnavailable === true) restoreSession();
      else cleanupSessionSnapshot(sessionSnapshot);
      return {
        ok: true,
        report: validation.right,
        attempts,
        stdout: current.stdout,
        ...processMetadata(current),
      };
    }
    restoreSession();
    return {
      ok: false,
      failure: validation.left,
      sessionUsability: "unknown",
      attempts,
      stdout: current.stdout,
      ...processMetadata(current),
    };
  });

export const piReviewerAgentRuntime = {
  review: reviewWithPi,
};

const validateRunResult = <Output>(
  input: ReviewerAgentInput<Output>,
  result: ReviewerProcessResult,
  _attempts: number,
) => input.decodeOutput(parseTaggedReviewerOutput(result.stdout));

const runReviewerProcess = (
  run: () => Promise<ReviewerProcessResult>,
): Effect.Effect<ReviewerProcessResult, ReviewerExecutionFailed> =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new ReviewerExecutionFailed({
        operationName: "run_reviewer_process",
        message:
          error instanceof ReviewerProcessExecutionFailed ? error.message : errorMessage(error),
        kind: "process_execution",
        sessionUsability:
          error instanceof ReviewerProcessExecutionFailed ? error.sessionUsability : "unknown",
      }),
  });

const reviewerProcessFailure = (
  failure: ReviewerExecutionFailed,
  attempts: number,
  stdout: string,
): ReviewerAgentResult<never> => ({
  ok: false,
  failure,
  sessionUsability: classifyReviewerSessionUsability(failure),
  attempts,
  stdout,
});

const classifyReviewerSessionUsability = (
  failure: ReviewerRuntimeFailure,
): ReviewerSessionUsability => failure.sessionUsability ?? "unknown";

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
