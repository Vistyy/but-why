import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

import {
  piReviewerAgentRuntime,
  ReviewerExecutionFailed,
} from "../../src/agent/reviewerAgentRuntime.js";
import type {
  ReviewerProcessExecutor,
  ReviewerProcessResult,
} from "../../src/agent/reviewerExecution.js";
import { ReviewerProcessExecutionFailed } from "../../src/agent/reviewerExecution.js";
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
      let prompt = "";
      const reviewerExecutor: ReviewerProcessExecutor = {
        execute: (input) => {
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

  it.effect("retries a dangling Artifact reference and accepts the corrected report", () =>
    Effect.gen(function* () {
      const corrected = processResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      const resume = vi.fn(() => Effect.succeed(corrected));
      const dangling = processResult(
        '<reviewer-output>{"findings":[{"title":"Mismatch","description":"Incomplete behavior.","evidence":"Missing output.","files":[],"artifactRefs":["artifact:123e4567-e89b-42d3-a456-426614174000/checks/missing/stdout.txt"]}]}</reviewer-output>',
        resume,
      );

      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor: { execute: () => Effect.succeed(dangling) },
        reviewer: "acceptance",
        decodeOutput: decodeEmptyFindings,
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({ ok: true, attempts: 2, report: { findings: [] } });
      expect(resume).toHaveBeenCalledWith(expect.stringContaining("does not resolve"));
    }),
  );

  it.effect("accepts a corrected report on the third attempt", () =>
    Effect.gen(function* () {
      const third = processResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      const resumeSecond = vi.fn(() => Effect.succeed(third));
      const second = processResult(
        '<reviewer-output>{"findings":"wrong"}</reviewer-output>',
        resumeSecond,
      );
      const resumeFirst = vi.fn(() => Effect.succeed(second));
      const first = processResult("<reviewer-output>not json</reviewer-output>", resumeFirst);
      const run = vi.fn(() => Effect.succeed(first));

      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor: { execute: run },
        reviewer: "acceptance",
        decodeOutput: decodeEmptyFindings,
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toEqual({
        ok: true,
        report: { findings: [] },
        attempts: 3,
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
        invocationUsage: [null, null, null],
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledTimes(1);
      expect(resumeSecond).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledWith(expect.stringContaining("$: Expected"));
      expect(resumeSecond).toHaveBeenCalledWith(
        expect.stringContaining("findings: Expected ReadonlyArray"),
      );
    }),
  );

  it.effect("fails after three invalid outputs without a fourth invocation", () =>
    Effect.gen(function* () {
      const resumeThird = vi.fn(() => Effect.succeed(processResult("must not run")));
      const third = processResult(
        '<reviewer-output>{"findings":[{"title":"T"}]}</reviewer-output>',
        resumeThird,
      );
      const resumeSecond = vi.fn(() => Effect.succeed(third));
      const second = processResult(
        '<reviewer-output>{"findings":"wrong"}</reviewer-output>',
        resumeSecond,
      );
      const resumeFirst = vi.fn(() => Effect.succeed(second));
      const first = processResult("<reviewer-output>not json</reviewer-output>", resumeFirst);
      const run = vi.fn(() => Effect.succeed(first));

      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor: { execute: run },
        reviewer: "acceptance",
        decodeOutput: decodeEmptyFindings,
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 3,
        failure: {
          _tag: "ReviewerExecutionFailed",
          operationName: "decode_reviewer_output",
        },
        sessionUsability: "unknown",
        stdout: '<reviewer-output>{"findings":[{"title":"T"}]}</reviewer-output>',
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledTimes(1);
      expect(resumeSecond).toHaveBeenCalledTimes(1);
      expect(resumeThird).not.toHaveBeenCalled();
      expect(resumeFirst).toHaveBeenCalledWith(expect.stringContaining("$: Expected"));
      expect(resumeSecond).toHaveBeenCalledWith(
        expect.stringContaining("findings: Expected ReadonlyArray"),
      );
    }),
  );

  it.effect("stops after a failed output correction invocation", () =>
    Effect.gen(function* () {
      const resumeFirst = vi.fn(() =>
        Effect.fail(
          new ReviewerProcessExecutionFailed({
            message: "provider failed",
            sessionUsability: "unknown",
          }),
        ),
      );
      const first = processResult("<reviewer-output>not json</reviewer-output>", resumeFirst);
      const run = vi.fn(() => Effect.succeed(first));

      const result = yield* piReviewerAgentRuntime.review({
        reviewerExecutor: { execute: run },
        reviewer: "acceptance",
        decodeOutput: decodeEmptyFindings,
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 2,
        failure: {
          _tag: "ReviewerExecutionFailed",
          operationName: "run_reviewer_process",
          message: "provider failed",
        },
        sessionUsability: "unknown",
        stdout: "<reviewer-output>not json</reviewer-output>",
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(resumeFirst).toHaveBeenCalledTimes(1);
    }),
  );
});

const processResult = (
  stdout: string,
  resume?: ReviewerProcessResult["resume"],
): ReviewerProcessResult => ({
  stdout,
  ...(resume === undefined ? {} : { resume }),
});
