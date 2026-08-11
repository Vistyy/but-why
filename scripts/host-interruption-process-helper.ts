import { appendFileSync, readFileSync } from "node:fs";
import { Effect } from "effect";

import { executeHostCommandEffect } from "../src/command/hostCommand.js";
import {
  hostInterruptionExitCode,
  runWithHostInterruption,
} from "../src/command/hostInterruption.js";

// biome-ignore lint/complexity/useLiteralKeys: Test helper process environment.
const eventsPath = process.env["BUT_WHY_TEST_EVENTS_PATH"];
// biome-ignore lint/complexity/useLiteralKeys: Test helper process environment.
const childPidPath = process.env["BUT_WHY_TEST_CHILD_PID_PATH"];
if (eventsPath === undefined || childPidPath === undefined) {
  throw new Error("Host interruption test paths are required.");
}

const processIsGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

const appendEvent = (event: string): void => appendFileSync(eventsPath, `${event}\n`);

const program = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const childPid = Number(readFileSync(childPidPath, "utf8"));
        appendEvent(`workspace-cleanup:${processIsGone(childPid) ? "child-gone" : "child-alive"}`);
      }),
    );
    yield* executeHostCommandEffect({
      command: "sh",
      args: [
        "-c",
        `sh -c 'trap "" TERM; exec sleep 30' & child=$!; printf '%s' "$child" > '${childPidPath}'; wait "$child"`,
      ],
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
