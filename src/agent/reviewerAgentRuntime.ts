import { pi, type Sandbox, type SandboxRunResult } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import { parseTaggedReviewerOutput } from "./reviewerOutputWire.js";
import { buildReviewerOutputCorrectionPrompt } from "./reviewerPrompts.js";
import {
  decodeReviewerOutputContract,
  validateReviewerArtifactRefs,
  type ReviewerOutput,
} from "../contracts/reviewerOutput.js";
import {
  SandcastleToolingFailed,
  type ValidationToolingFailure,
} from "../change/validation/validationToolingFailures.js";

export type ReviewerAgentRuntime = {
  readonly review: (input: ReviewerAgentInput) => Effect.Effect<ReviewerAgentResult>;
};

export type ReviewerAgentInput = {
  readonly sandbox: Pick<Sandbox, "run">;
  readonly reviewer: string;
  readonly validationRunId: string;
  readonly availableArtifactRefs: readonly string[];
  readonly prompt: string;
  readonly profile: ResolvedPiAgentProfile;
};

export type ReviewerAgentResult =
  | {
      readonly ok: true;
      readonly report: ReviewerOutput;
      readonly attempts: number;
      readonly stdout: string;
    }
  | {
      readonly ok: false;
      readonly failure: ValidationToolingFailure;
      readonly attempts: number;
      readonly stdout: string;
    };

const reviewWithPi = (input: ReviewerAgentInput): Effect.Effect<ReviewerAgentResult> =>
  Effect.gen(function* () {
    const initial = yield* Effect.either(
      runSandbox(() =>
        input.sandbox.run({
          agent: pi(input.profile.agentModel, {
            ...(input.profile.thinking === undefined ? {} : { thinking: input.profile.thinking }),
          }),
          prompt: input.prompt,
          maxIterations: 1,
          name: `${input.reviewer} Review`,
        }),
      ),
    );
    if (initial._tag === "Left") return sandcastleFailure(initial.left, 1, "");

    const first = yield* Effect.either(validateRunResult(input, initial.right, 1));
    if (first._tag === "Right") {
      return { ok: true, report: first.right, attempts: 1, stdout: initial.right.stdout };
    }
    const resume = initial.right.resume;
    if (resume === undefined) {
      return { ok: false, failure: first.left, attempts: 1, stdout: initial.right.stdout };
    }

    const corrected = yield* Effect.either(
      runSandbox(() => resume(buildReviewerOutputCorrectionPrompt(first.left))),
    );
    if (corrected._tag === "Left") {
      return sandcastleFailure(corrected.left, 2, initial.right.stdout);
    }

    const second = yield* Effect.either(validateRunResult(input, corrected.right, 2));
    return second._tag === "Right"
      ? { ok: true, report: second.right, attempts: 2, stdout: corrected.right.stdout }
      : { ok: false, failure: second.left, attempts: 2, stdout: corrected.right.stdout };
  });

export const piReviewerAgentRuntime: ReviewerAgentRuntime = {
  review: reviewWithPi,
};

const validateRunResult = (input: ReviewerAgentInput, result: SandboxRunResult, attempts: number) =>
  decodeReviewerOutputContract({
    reviewer: input.reviewer,
    attempts,
    output: parseTaggedReviewerOutput(result.stdout),
  }).pipe(
    Effect.flatMap((output) =>
      validateReviewerArtifactRefs({
        reviewer: input.reviewer,
        attempts,
        validationRunId: input.validationRunId,
        output,
        availableArtifactRefs: input.availableArtifactRefs,
      }),
    ),
  );

const runSandbox = (
  run: () => Promise<SandboxRunResult>,
): Effect.Effect<SandboxRunResult, SandcastleToolingFailed> =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new SandcastleToolingFailed({
        operationName: "run_reviewer_agent",
        message: errorMessage(error),
      }),
  });

const sandcastleFailure = (
  failure: SandcastleToolingFailed,
  attempts: number,
  stdout: string,
): ReviewerAgentResult => ({ ok: false, failure, attempts, stdout });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
