import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type {
  ReviewerAgentInput,
  ReviewerAgentRuntime,
} from "../../src/agent/reviewerAgentRuntime.js";
import type { TaskReviewerOutput } from "../../src/task/review/taskReviewerOutput.js";
import type { TaskSimplificationAdviceOutput } from "../../src/task/review/taskSimplificationAdviceOutput.js";
import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";

const advice: TaskSimplificationAdviceOutput =
  "Keep the core result and remove the optional integration because repository evidence shows it is not part of the supported path. The retained result remains sufficient; users of that integration would need another route.";

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

it.effect("corrects malformed advice output in the same workspace and Agent Session", () =>
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

    const observed: ReviewerAgentInput<TaskSimplificationAdviceOutput>[] = [];
    let adviceCalls = 0;
    const adviceReviewer: ReviewerAgentRuntime<TaskSimplificationAdviceOutput> = {
      review: (input) => {
        observed.push(input);
        adviceCalls += 1;
        const sessionStorageRoot = input.sessionStorageRoot;
        if (sessionStorageRoot === undefined)
          throw new Error("Expected Underengineer session root");
        mkdirSync(sessionStorageRoot, { recursive: true });
        const sessionFilePath = join(sessionStorageRoot, "underengineer.jsonl");
        writeFileSync(
          sessionFilePath,
          `${JSON.stringify({ type: "session", id: input.sessionId, cwd: input.commandCwd ?? root })}\n`,
        );
        if (adviceCalls === 1) {
          const cwd = input.commandCwd ?? root;
          writeFileSync(join(cwd, ".but-why", "config.json"), "changed\n");
          expect(runTestProcess("git", ["add", ".but-why/config.json"], { cwd }).status).toBe(0);
          writeFileSync(join(cwd, "underengineer-untracked"), "remove\n");
          return Effect.succeed({
            ok: false as const,
            failure: {
              kind: "output_contract" as const,
              operationName: "decode_task_simplification_advice_output",
              message: "The advice must be one nonblank Markdown block.",
              correctionPrompt: "Return the complete Markdown advice form.",
              sessionReference: "underengineer-session",
            },
            sessionUsability: "unknown" as const,
            attempts: 1,
            stdout: "invalid advice",
            sessionReference: "underengineer-session",
            sessionFilePath,
          });
        }
        expect(
          readFileSync(join(input.commandCwd ?? root, ".but-why", "config.json"), "utf8"),
        ).toBe(readFileSync(join(root, ".but-why", "config.json"), "utf8"));
        const cwd = input.commandCwd ?? root;
        expect(runTestProcessOrThrow("git", ["status", "--porcelain=v1"], { cwd })).toBe("");
        expect(existsSync(join(input.commandCwd ?? root, "underengineer-untracked"))).toBe(false);
        return Effect.succeed({
          ok: true as const,
          report: advice,
          attempts: 1,
          stdout: "valid advice",
          sessionReference: "underengineer-session",
          sessionFilePath,
        });
      },
    };
    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: passingReviewer,
      underengineerAgentRuntime: adviceReviewer,
    });

    expect(submitted.status, submitted.stdout).toBe(0);
    expect(adviceCalls).toBe(2);
    expect(observed[1]?.resumeSession).toBe("by-agent-1");
    expect(observed[1]?.prompt).toBe("Return the complete Markdown advice form.");
    const output = JSON.parse(submitted.stdout) as { review: { id: number } };
    const shown = yield* runByInProcessEffect(
      root,
      ["task", "review", "show", String(output.review.id)],
      undefined,
      { globalConfigPath },
    );
    expect(JSON.parse(shown.stdout)).toMatchObject({
      review: {
        simplificationAdviceAttempt: {
          state: "completed",
          agentSession: {
            invocations: [{ settlementKind: "returned" }, { settlementKind: "returned" }],
          },
        },
      },
    });
    const adviceInvocations = JSON.parse(shown.stdout).review.simplificationAdviceAttempt
      .agentSession.invocations;
    expect(adviceInvocations[0].continuationId).toBe(adviceInvocations[1].continuationId);
  }),
);

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
    const progress: string[] = [];
    writeFileSync(proposal, "Exact proposal");
    yield* runByInProcessEffect(root, ["task", "create", "--title", "Advice", "--file", proposal]);

    const submitted = yield* runByInProcessEffect(root, ["task", "submit", "BY-1"], undefined, {
      globalConfigPath,
      taskReviewerAgentRuntime: passingReviewer,
      underengineerAgentRuntime: adviceReviewer,
      writeStderr: (message) => progress.push(message),
    });
    expect(submitted.status, submitted.stdout).toBe(0);
    expect(progress).toEqual([
      "Underengineer started: profile=review model=test-model thinking=default\n",
      expect.stringMatching(/^Underengineer passed in \d+(?:h\d+)?(?:m\d+)?s\n$/),
      "Task Review started: profile=review model=test-model thinking=default\n",
      expect.stringMatching(/^Task Review passed in \d+(?:h\d+)?(?:m\d+)?s\n$/),
    ]);
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
