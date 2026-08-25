import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";

import { piReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type {
  ReviewerProcessExecutor,
  ReviewerProcessInput,
  ReviewerProcessResult,
} from "../../src/agent/reviewerExecution.js";
import { executeHostCommandEffect } from "../../src/command/hostCommand.js";
import {
  hostInterruptionExitCode,
  runWithHostInterruption,
} from "../../src/command/hostInterruption.js";

// biome-ignore lint/complexity/useLiteralKeys: Test helper process environment.
const eventsPath = process.env["BUT_WHY_TEST_EVENTS_PATH"];
// biome-ignore lint/complexity/useLiteralKeys: Test helper process environment.
const childPidPath = process.env["BUT_WHY_TEST_CHILD_PID_PATH"];
// biome-ignore lint/complexity/useLiteralKeys: Test helper process environment.
const sessionPath = process.env["BUT_WHY_TEST_SESSION_PATH"];
if (eventsPath === undefined || childPidPath === undefined || sessionPath === undefined) {
  throw new Error("Host interruption test paths are required.");
}

const originalSession = "original session\n";
writeFileSync(sessionPath, originalSession);

const processIsGone = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return false;
    const state = stat.slice(commandEnd + 2).split(" ")[0];
    return state === "Z";
  } catch {
    return true;
  }
};

const appendEvent = (event: string): void => appendFileSync(eventsPath, `${event}\n`);

const reviewerEffect = (
  _input: ReviewerProcessInput,
): Effect.Effect<ReviewerProcessResult, never> =>
  Effect.sync(() => appendFileSync(sessionPath, "partial invocation\n")).pipe(
    Effect.zipRight(
      executeHostCommandEffect({
        command: "sh",
        args: [
          "-c",
          `sh -c 'trap "" TERM; exec sleep 30' & child=$!; printf '%s' "$child" > '${childPidPath}'; wait "$child"`,
        ],
      }),
    ),
    Effect.map(() => ({ stdout: '<reviewer-output>{"findings":[]}</reviewer-output>' })),
    Effect.orDie,
  );

const reviewerExecutor: ReviewerProcessExecutor = {
  execute: reviewerEffect,
};

const program = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const childPid = Number(readFileSync(childPidPath, "utf8"));
        const childState = processIsGone(childPid) ? "child-gone" : "child-alive";
        const transcriptState =
          readFileSync(sessionPath, "utf8") === `${originalSession}partial invocation\n`
            ? "transcript-retained"
            : "transcript-unexpected";
        appendEvent(`workspace-cleanup:${childState}:${transcriptState}`);
      }),
    );
    yield* piReviewerAgentRuntime.review({
      reviewerExecutor,
      reviewer: "acceptance",
      decodeOutput: (output) => Effect.succeed(output),
      systemPrompt: "Act as the Acceptance Reviewer.",
      prompt: "Review the Candidate.",
      profile: {
        agentProfile: "review",
        scope: "repo",
        profile: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } },
      },
      commandCwd: dirname(sessionPath),
      sessionStorageRoot: dirname(sessionPath),
      resumeSession: "stored-session",
    });
  }),
);

void runWithHostInterruption(
  program,
  (completion) => {
    appendEvent(`complete:${completion.signal ?? "none"}`);
    process.exitCode = hostInterruptionExitCode(completion.signal, completion.ok ? 0 : 1);
  },
  process,
);
