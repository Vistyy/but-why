import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { observeUntil } from "../support/observe.js";
import { startTestProcess } from "../support/testProcess.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const helper = join(repositoryRoot, "test/support/host-interruption-process-helper.ts");
const tsxLoader = join(repositoryRoot, "node_modules/tsx/dist/loader.mjs");
const observationDeadlineMs = 5_000;
const settlementDeadlineMs = 5_000;
const processTestDeadlineMs = 20_000;

describe("host interruption process boundary", { timeout: processTestDeadlineMs }, () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("finishes reviewer process-tree termination before workspace cleanup for %s", async (signal, exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "but-why-host-interruption-"));
    const eventsPath = join(root, "events");
    const childPidPath = join(root, "child-pid");
    const sessionsRoot = join(root, "sessions");
    mkdirSync(sessionsRoot);
    const sessionPath = join(sessionsRoot, "pi-session.jsonl");
    const executable = startTestProcess(process.execPath, ["--import", tsxLoader, helper], {
      cwd: root,
      detached: true,
      env: {
        BUT_WHY_TEST_EVENTS_PATH: eventsPath,
        BUT_WHY_TEST_CHILD_PID_PATH: childPidPath,
        BUT_WHY_TEST_SESSION_PATH: sessionPath,
      },
    });
    const completion = processCompletion(executable);

    try {
      await waitForFile(childPidPath);
      const reviewerPid = Number(readFileSync(childPidPath, "utf8"));
      expect(processIsGone(reviewerPid)).toBe(false);
      executable.kill(signal);
      const result = await settleWithinDeadline(completion, "host interruption process settlement");

      expect(result.status, result.stderr).toBe(exitCode);
      expect(processIsGone(reviewerPid)).toBe(true);
      expect(readFileSync(eventsPath, "utf8").trim().split("\n")).toEqual([
        "workspace-cleanup:child-gone:transcript-retained",
        `complete:${signal}`,
      ]);
    } finally {
      if (executable.pid === undefined) {
        executable.kill("SIGKILL");
      } else {
        try {
          process.kill(-executable.pid, "SIGKILL");
        } catch {
          executable.kill("SIGKILL");
        }
      }
      await settleWithinDeadline(completion, "host interruption process cleanup");
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const waitForFile = (path: string): Promise<string> =>
  observeUntil({
    description: `file ${path} to contain a PID`,
    observe: () => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    },
    isReady: (contents) => contents.length > 0,
    timeoutMs: observationDeadlineMs,
  });

const settleWithinDeadline = <T>(promise: Promise<T>, description: string): Promise<T> =>
  observeUntil({
    description,
    observe: () => promise,
    timeoutMs: settlementDeadlineMs,
  });

const processCompletion = (
  child: ReturnType<typeof startTestProcess>,
): Promise<{ readonly status: number | null; readonly stderr: string }> =>
  new Promise((resolveCompletion, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (status) => resolveCompletion({ status, stderr }));
  });

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
