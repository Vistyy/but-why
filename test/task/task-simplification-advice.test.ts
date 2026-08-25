import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { TaskReviewerOutput } from "../../src/task/review/taskReviewerOutput.js";
import type { TaskSimplificationAdviceOutput } from "../../src/task/review/taskSimplificationAdviceOutput.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";

const advice: TaskSimplificationAdviceOutput = {
  practicalCoreOutcome: "Deliver the requested result.",
  options: [
    {
      retainedOutcome: "Deliver the requested result.",
      removedComplexity: "Remove a nonessential integration.",
      lostBehavior: "The optional integration is no longer available.",
      adverseConsequence: "Users relying on it must use another path.",
      repositoryEvidence: "The integration is not part of the core path.",
      materialUncertainty: "Its external consumers are not fully known.",
    },
  ],
  noSafeSimplificationReason: null,
};

const passingReviewer: ReviewerAgentRuntime<TaskReviewerOutput> = {
  review: () =>
    Effect.succeed({
      ok: true as const,
      report: { findings: [] },
      attempts: 1,
      stdout: "",
    }),
};

const adviceReviewer: ReviewerAgentRuntime<TaskSimplificationAdviceOutput> = {
  review: () =>
    Effect.succeed({
      ok: true as const,
      report: advice,
      attempts: 1,
      stdout: "",
    }),
};

it.effect("runs one separate advice attempt and retains its first completion", () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const globalConfigPath = join(root, "global.json");
    yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
    commitButWhyConfigAndRecordDefault(root);
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "review" },
        agentProfiles: { review: { agentRuntime: "pi", runtimeConfig: { model: "test-model" } } },
      }),
    );
    const proposal = join(root, "proposal.txt");
    writeFileSync(proposal, "Exact proposal");
    yield* runByInProcessEffect(root, ["task", "create", "--title", "Advice", "--file", proposal]);

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: passingReviewer,
      underengineerAgentRuntime: adviceReviewer,
    });
    expect(submitted.status, submitted.stdout).toBe(0);
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      simplificationAdvice: advice,
      task: { state: "todo" },
      review: { outcome: "passed" },
    });
    const submittedOutput = JSON.parse(submitted.stdout) as { review: { id: number } };
    const review = yield* runByInProcessEffect(
      root,
      ["task", "review", "show", String(submittedOutput.review.id)],
      undefined,
      { globalConfigPath },
    );
    expect(JSON.parse(review.stdout)).toMatchObject({
      review: {
        simplificationAdviceAttempt: {
          state: "completed",
          configuration: {
            profile: { agentProfile: "review" },
            builtInInstructions: expect.stringContaining("TASK SIMPLIFICATION ADVICE"),
          },
          agentSession: { id: expect.any(Number), invocations: [{ id: expect.any(Number) }] },
        },
      },
    });
    const shown = yield* runByInProcessEffect(root, ["task", "show", "BY-1"], undefined, {
      globalConfigPath,
    });
    expect(JSON.parse(shown.stdout)).toMatchObject({ task: { simplificationAdvice: advice } });
  }),
);
