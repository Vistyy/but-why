import type { Sandbox, SandboxRunResult } from "@ai-hero/sandcastle";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, vi } from "vitest";

import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";

const profile = {
  agentRuntime: "pi" as const,
  agentModel: "openai-codex/gpt-5.5",
  thinking: "high" as const,
};

describe("Pi reviewer agent runtime", () => {
  it.effect("runs a role prompt and decodes trustworthy reviewer output", () =>
    Effect.gen(function* () {
      let prompt = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        prompt = options.prompt ?? "";
        return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      };

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Judge only approved intent for the exact Candidate.",
        profile,
      });

      expect(result).toEqual({
        ok: true,
        report: { findings: [] },
        attempts: 1,
        stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
      });
      expect(prompt).toBe("Judge only approved intent for the exact Candidate.");
    }),
  );

  it.effect("launches reviewers with an isolated Pi resource and tool boundary", () =>
    Effect.gen(function* () {
      let command = "";
      const run: Pick<Sandbox, "run">["run"] = async (options) => {
        const built = options.agent.buildPrintCommand({
          prompt: options.prompt ?? "",
          dangerouslySkipPermissions: true,
        });
        command = built.command;
        return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      };

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "specialist:security",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({ ok: true, attempts: 1 });
      expect(command).toBe(
        "pi -p --mode json --model 'openai-codex/gpt-5.5' --thinking high --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --tools read,bash,grep,find,ls",
      );
      expect(command).not.toContain("--subagent");
      expect(command).not.toContain("--edit");
      expect(command).not.toContain("--write");
    }),
  );

  it.effect("retries a dangling Artifact reference and accepts the corrected report", () =>
    Effect.gen(function* () {
      const corrected = runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
      const resume = vi.fn(() => Promise.resolve(corrected));
      const dangling = runResult(
        '<reviewer-output>{"findings":[{"title":"Mismatch","description":"Incomplete behavior.","severity":"high","evidence":"Missing output.","files":[],"artifactRefs":["artifact:123e4567-e89b-42d3-a456-426614174000/checks/missing/stdout.txt"]}]}</reviewer-output>',
        resume,
      );

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: {
          run: () => Promise.resolve(dangling),
        } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({ ok: true, attempts: 2, report: { findings: [] } });
      expect(resume).toHaveBeenCalledWith(expect.stringContaining("does not resolve"));
    }),
  );

  it.effect("fails tooling after one output correction", () =>
    Effect.gen(function* () {
      const third = runResult("must not run");
      const resumeAfterCorrection = vi.fn(() => Promise.resolve(third));
      const second = runResult("invalid again", resumeAfterCorrection);
      const first = runResult("invalid", () => Promise.resolve(second));
      const run = vi.fn(() => Promise.resolve(first));

      const result = yield* piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        validationRunId: "123e4567-e89b-42d3-a456-426614174000",
        availableArtifactRefs: [],
        prompt: "Review the Candidate.",
        profile,
      });

      expect(result).toMatchObject({
        ok: false,
        attempts: 2,
        failure: {
          _tag: "ReviewerOutputContractFailed",
          reviewer: "acceptance",
          attempts: 2,
        },
      });
      expect(resumeAfterCorrection).not.toHaveBeenCalled();
    }),
  );
});

const runResult = (stdout: string, resume?: SandboxRunResult["resume"]): SandboxRunResult => ({
  iterations: [],
  stdout,
  commits: [],
  ...(resume === undefined ? {} : { resume }),
});
