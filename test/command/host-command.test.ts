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

describe("host command Adapter", () => {
  it("captures stdout, stderr, and the exit status", async () => {
    await expect(
      executeHostCommand({
        command: "sh",
        args: ["-c", "printf output; printf failure >&2; exit 7"],
      }),
    ).resolves.toEqual({ exitCode: 7, stdout: "output", stderr: "failure" });
  });

  it("translates spawn failures into a typed error", async () => {
    await expect(executeHostCommand({ command: "missing-host-command" })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HostCommandError && error.message.includes("missing-host-command"),
    );
  });

  effectIt.effect("interrupts a command and its ordinary descendant", () =>
    Effect.gen(function* () {
      const directory = mkdtempSync(join(tmpdir(), "but-why-host-command-"));
      const pidFile = join(directory, "pid");
      try {
        const fiber = yield* Effect.fork(
          executeHostCommandEffect({
            command: "sh",
            args: ["-c", `sleep 30 & child=$!; printf '%s' "$child" > '${pidFile}'; wait "$child"`],
          }),
        );
        yield* Effect.promise(() => waitForFile(pidFile));
        expect(existsSync(pidFile)).toBe(true);
        yield* Fiber.interrupt(fiber);
        yield* Effect.promise(() => waitForProcessExit(Number(readFileSync(pidFile, "utf8"))));
        expect(processIsGone(Number(readFileSync(pidFile, "utf8")))).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }),
  );
});

const waitForFile = async (path: string): Promise<void> => {
  for (let attempt = 0; attempt < 20 && !existsSync(path); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const waitForProcessExit = async (pid: number): Promise<void> => {
  for (let attempt = 0; attempt < 20 && !processIsGone(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const processIsGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
