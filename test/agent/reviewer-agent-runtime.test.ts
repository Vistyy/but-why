import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import {
  piReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type {
  ReviewerProcessExecutor,
  ReviewerProcessResult,
} from "../../src/agent/reviewerExecution.js";
import {
  decodeReviewerOutputContract,
  validateReviewerArtifactRefs,
} from "../../src/agent/reviewerOutput.js";
import { buildReviewerOutputCorrectionPrompt } from "../../src/reviewerPrompts/reviewerPromptSupport.js";

const decodeEmptyFindings = (output: unknown) =>
  decodeReviewerOutputContract({ reviewer: "acceptance", attempts: 1, output }).pipe(
    Effect.flatMap((decoded) =>
      validateReviewerArtifactRefs({
        reviewer: "acceptance",
        attempts: 1,
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        output: decoded,
        availableArtifactRefs: [],
      }),
    ),
    Effect.mapError(
      (failure) =>
        new ReviewerExecutionFailed({
          kind: "output_contract",
          operationName: failure.operationName,
          message: failure.message,
          diagnostics: failure.diagnostics,
          correctionPrompt: buildReviewerOutputCorrectionPrompt(failure),
        }),
    ),
  );

const profile = {
  agentProfile: "review",
  scope: "global" as const,
  profile: {
    agentRuntime: "pi" as const,
    runtimeConfig: {
      model: "openai-codex/gpt-5.5",
      thinking: "high" as const,
      extensions: [
        "~/.pi/agent/extensions/package-manager-policy",
        "~/.pi/agent/extensions/web-search",
        "~/.pi/agent/extensions/openai-remote-compaction",
      ],
      skills: ["~/.pi/agent/skills/codebase-design"],
      tools: ["read", "bash", "grep", "find", "ls", "web_search", "web_fetch", "web_content_get"],
    },
  },
};

describe("Pi reviewer agent runtime", () => {
  it.effect("runs a role prompt and decodes trustworthy reviewer output", () =>
    Effect.gen(function* () {
      let systemPrompt = "";
      let prompt = "";
      const reviewerExecutor: ReviewerProcessExecutor = {
        execute: (input) => {
          systemPrompt = input.systemPrompt;
          prompt = input.prompt;
          return Effect.succeed(
            processResult('<reviewer-output>{"findings":[]}</reviewer-output>'),
          );
        },
      };

      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor,
        reviewer: "acceptance",
        decodeOutput: decodeEmptyFindings,
        systemPrompt: "Act as the Acceptance Reviewer.",
        prompt: "Judge only approved intent for the exact Candidate.",
        profile,
      });

      expect(result).toEqual({
        ok: true,
        report: { findings: [] },
        attempts: 1,
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
        invocationUsage: [null],
      });
      expect(systemPrompt).toBe("Act as the Acceptance Reviewer.");
      expect(prompt).toBe("Judge only approved intent for the exact Candidate.");
    }),
  );

  it.effect("returns output from a caller-owned decoder", () =>
    Effect.gen(function* () {
      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor: {
          execute: () =>
            Effect.succeed(processResult('<reviewer-output>{"verdict":"clear"}</reviewer-output>')),
        },
        reviewer: "caller",
        systemPrompt: "Act as the caller-defined Reviewer.",
        decodeOutput: (output) =>
          typeof output === "object" &&
          output !== null &&
          "verdict" in output &&
          output.verdict === "clear"
            ? Effect.succeed("decoded by caller" as const)
            : Effect.fail(
                new ReviewerExecutionFailed({
                  kind: "output_contract",
                  operationName: "decode_reviewer_output",
                  message: "Expected a clear verdict.",
                }),
              ),
        prompt: "Review with the caller contract.",
        profile,
      });

      expect(result).toMatchObject({ ok: true, report: "decoded by caller", attempts: 1 });
    }),
  );

  it.effect("returns a neutral failure when reviewer output is missing", () =>
    Effect.gen(function* () {
      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor: {
          execute: () =>
            Effect.succeed(processResult("Reviewer completed without structured output.")),
        },
        reviewer: "acceptance",
        decodeOutput: decodeEmptyFindings,
        systemPrompt: "Act as the Acceptance Reviewer.",
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 1,
        failure: {
          _tag: "ReviewerExecutionFailed",
          operationName: "decode_reviewer_output",
        },
      });
    }),
  );

  it.effect("does not retry an invalid output inside the process runtime", () =>
    Effect.gen(function* () {
      let executions = 0;
      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor: {
          execute: () => {
            executions += 1;
            return Effect.succeed(processResult("<reviewer-output>not json</reviewer-output>"));
          },
        },
        reviewer: "acceptance",
        decodeOutput: decodeEmptyFindings,
        systemPrompt: "Act as the Acceptance Reviewer.",
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({ ok: false, attempts: 1 });
      expect(executions).toBe(1);
    }),
  );
});

const processResult = (stdout: string): ReviewerProcessResult => ({ stdout });
