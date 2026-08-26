import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it as effectIt, expect } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { it } from "vitest";

import {
  executeHostCommand,
  executeHostCommandEffect,
  HostCommandError,
} from "../../src/command/hostCommand.js";
import { observeUntil } from "../support/observe.js";

const hostCommandProcessTestTimeoutMs = 20_000;

describe("host command Adapter", () => {
  it("captures stdout, stderr, and the exit status", async () => {
    await expect(
      executeHostCommand({
        command: "sh",
        args: ["-c", "printf output; printf failure >&2; exit 7"],
      }),
    ).resolves.toEqual({ exitCode: 7, stdout: "output", stderr: "failure" });
  });

  it("closes command stdin when no input is supplied", async () => {
    await expect(
      executeHostCommand({ command: "sh", args: ["-c", "cat; printf stdin-closed"] }),
    ).resolves.toEqual({ exitCode: 0, stdout: "stdin-closed", stderr: "" });
  });

  it("writes supplied command stdin", async () => {
    await expect(
      executeHostCommand({ command: "sh", args: ["-c", "cat"], stdin: "review prompt" }),
    ).resolves.toEqual({ exitCode: 0, stdout: "review prompt", stderr: "" });
  });

  it("translates spawn failures into a typed error", async () => {
    await expect(executeHostCommand({ command: "missing-host-command" })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HostCommandError && error.message.includes("missing-host-command"),
    );
  });

  effectIt.effect(
    "interrupts a command and a descendant that ignores SIGTERM",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "but-why-host-command-"));
      const pidFile = join(directory, "pid");
      return Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            executeHostCommandEffect({
              command: "sh",
              args: [
                "-c",
                `sh -c 'trap "" TERM; exec sleep 30' & child=$!; printf '%s' "$child" > '${pidFile}'; wait "$child"`,
              ],
            }),
          );
          yield* Effect.addFinalizer(() => Fiber.interrupt(fiber).pipe(Effect.asVoid));
          yield* Effect.promise(() => waitForFile(pidFile));
          expect(existsSync(pidFile)).toBe(true);
          yield* Fiber.interrupt(fiber);
          yield* Effect.promise(() => waitForProcessExit(Number(readFileSync(pidFile, "utf8"))));
          expect(processIsGone(Number(readFileSync(pidFile, "utf8")))).toBe(true);
        }),
      ).pipe(
        Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true, force: true }))),
      );
    },
    hostCommandProcessTestTimeoutMs,
  );

  effectIt.effect(
    "interrupts descendants after the command root exits",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "but-why-host-command-"));
      const rootPidFile = join(directory, "root-pid");
      const childPidFile = join(directory, "child-pid");
      return Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            executeHostCommandEffect({
              command: "sh",
              args: [
                "-c",
                `printf '%s' "$$" > '${rootPidFile}'; sh -c 'trap "" TERM; exec sleep 30' & child=$!; printf '%s' "$child" > '${childPidFile}'`,
              ],
            }),
          );
          yield* Effect.addFinalizer(() => Fiber.interrupt(fiber).pipe(Effect.asVoid));
          yield* Effect.promise(() => waitForFile(childPidFile));
          const rootPid = Number(readFileSync(rootPidFile, "utf8"));
          const childPid = Number(readFileSync(childPidFile, "utf8"));
          yield* Effect.promise(() => waitForProcessExit(rootPid));
          expect(processIsGone(rootPid)).toBe(true);
          expect(processIsGone(childPid)).toBe(false);
          yield* Fiber.interrupt(fiber);
          yield* Effect.promise(() => waitForProcessExit(childPid));
          expect(processIsGone(childPid)).toBe(true);
        }),
      ).pipe(
        Effect.ensuring(Effect.sync(() => rmSync(directory, { recursive: true, force: true }))),
      );
    },
    hostCommandProcessTestTimeoutMs,
  );
});

const waitForFile = (path: string): Promise<string> =>
  observeUntil({
    description: `file ${path} to contain the child PID`,
    observe: () => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    },
    isReady: (contents) => contents.length > 0,
    timeoutMs: 5_000,
  });

const waitForProcessExit = (pid: number): Promise<boolean> =>
  observeUntil({
    description: `process ${pid} to exit`,
    observe: () => processIsGone(pid),
    timeoutMs: 5_000,
  });

const processIsGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
