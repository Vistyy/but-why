import type { Sandbox, SandboxRunResult } from "@ai-hero/sandcastle";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { piReviewerAgentRuntime } from "../src/agent/reviewerAgentRuntime.js";

const profile = {
  agentRuntime: "pi" as const,
  agentModel: "openai-codex/gpt-5.5",
  thinking: "high" as const,
};

describe("Pi reviewer agent runtime", () => {
  it("runs a role prompt and decodes trustworthy reviewer output", async () => {
    let prompt = "";
    const run: Pick<Sandbox, "run">["run"] = async (options) => {
      prompt = options.prompt ?? "";
      return runResult('<reviewer-output>{"findings":[]}</reviewer-output>');
    };

    const result = await Effect.runPromise(
      piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        prompt: "Judge only approved intent for the exact Candidate.",
        profile,
      }),
    );

    expect(result).toEqual({
      ok: true,
      report: { findings: [] },
      attempts: 1,
      stdout: '<reviewer-output>{"findings":[]}</reviewer-output>',
    });
    expect(prompt).toContain("Judge only approved intent for the exact Candidate.");
    expect(prompt).toContain("<reviewer-output>");
  });

  it("exhausts bounded structured-output retries as a tooling failure", async () => {
    const third = runResult("still invalid");
    const second = runResult("invalid again", () => Promise.resolve(third));
    const first = runResult("invalid", () => Promise.resolve(second));
    const run = vi.fn(() => Promise.resolve(first));

    const result = await Effect.runPromise(
      piReviewerAgentRuntime.review({
        sandbox: { run } as unknown as Pick<Sandbox, "run">,
        reviewer: "acceptance",
        prompt: "Review the Candidate.",
        profile,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      attempts: 3,
      failure: {
        _tag: "ReviewerOutputContractFailed",
        reviewer: "acceptance",
        attempts: 3,
      },
    });
  });
});

const runResult = (stdout: string, resume?: SandboxRunResult["resume"]): SandboxRunResult => ({
  iterations: [],
  stdout,
  commits: [],
  ...(resume === undefined ? {} : { resume }),
});
