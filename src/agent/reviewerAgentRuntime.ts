import { pi, type Sandbox, type SandboxRunResult } from "@ai-hero/sandcastle";
import { Effect } from "effect";

import type { ResolvedPiAgentProfile } from "./agentProfiles.js";
import { parseTaggedReviewerOutput, reviewerOutputTag } from "./reviewerOutputWire.js";
import { decodeReviewerOutputContract, type ReviewerOutput } from "../contracts/reviewerOutput.js";
import {
  type ReviewerOutputContractFailed,
  SandcastleToolingFailed,
  type ValidationToolingFailure,
} from "../validation/validationToolingFailures.js";

export type ReviewerAgentRuntime = {
  readonly review: (input: ReviewerAgentInput) => Effect.Effect<ReviewerAgentResult>;
};

export type ReviewerAgentInput = {
  readonly sandbox: Pick<Sandbox, "run">;
  readonly reviewer: string;
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

const maxStructuredOutputRetries = 2;

const reviewWithPi = (input: ReviewerAgentInput): Effect.Effect<ReviewerAgentResult> =>
  Effect.gen(function* () {
    const initial = yield* Effect.either(
      runSandbox(() =>
        input.sandbox.run({
          agent: pi(input.profile.agentModel, {
            ...(input.profile.thinking === undefined ? {} : { thinking: input.profile.thinking }),
          }),
          prompt: reviewerPrompt(input.prompt),
          maxIterations: 1,
          name: `${input.reviewer} Review`,
        }),
      ),
    );
    if (initial._tag === "Left") return sandcastleFailure(initial.left, 1, "");

    let runResult: SandboxRunResult = initial.right;
    let attempts = 1;
    let stdout = runResult.stdout;
    while (true) {
      const decoded = yield* Effect.either(
        decodeReviewerOutputContract({
          reviewer: input.reviewer,
          attempts,
          output: parseTaggedReviewerOutput(stdout),
        }),
      );
      if (decoded._tag === "Right") {
        return { ok: true, report: decoded.right, attempts, stdout };
      }
      if (attempts > maxStructuredOutputRetries || runResult.resume === undefined) {
        return { ok: false, failure: decoded.left, attempts, stdout };
      }

      attempts += 1;
      const resume = runResult.resume;
      const resumed = yield* Effect.either(
        runSandbox(() => resume(structuredOutputCorrectionPrompt(decoded.left))),
      );
      if (resumed._tag === "Left") return sandcastleFailure(resumed.left, attempts, stdout);
      runResult = resumed.right;
      stdout = runResult.stdout;
    }
  });

export const piReviewerAgentRuntime: ReviewerAgentRuntime = {
  review: reviewWithPi,
};

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

const reviewerPrompt = (instructions: string): string =>
  [
    instructions,
    "",
    "Return exactly one JSON object inside this XML tag:",
    `<${reviewerOutputTag}>{"findings":[]}</${reviewerOutputTag}>`,
    "Each Finding must contain title, description, severity, evidence, files, and artifactRefs.",
  ].join("\n");

const structuredOutputCorrectionPrompt = (failure: ReviewerOutputContractFailed): string =>
  [
    "Your reviewer output did not match the required contract.",
    failure.message,
    `Return only the corrected JSON object inside <${reviewerOutputTag}>...</${reviewerOutputTag}>.`,
  ].join("\n");

const sandcastleFailure = (
  failure: SandcastleToolingFailed,
  attempts: number,
  stdout: string,
): ReviewerAgentResult => ({ ok: false, failure, attempts, stdout });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
