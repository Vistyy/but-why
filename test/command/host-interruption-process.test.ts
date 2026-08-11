import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { observeUntil } from "../support/observe.js";
import { startTestProcess } from "../support/testProcess.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const helper = join(repositoryRoot, "scripts/host-interruption-process-helper.ts");
const tsxLoader = join(repositoryRoot, "node_modules/tsx/dist/loader.mjs");

describe("host interruption process boundary", () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("finishes reviewer process-tree termination before workspace cleanup for %s", async (signal, exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "but-why-host-interruption-"));
    const eventsPath = join(root, "events");
    const childPidPath = join(root, "child-pid");
    const executable = startTestProcess(process.execPath, ["--import", tsxLoader, helper], {
      cwd: root,
      env: {
        BUT_WHY_TEST_EVENTS_PATH: eventsPath,
        BUT_WHY_TEST_CHILD_PID_PATH: childPidPath,
      },
    });
    const completion = processCompletion(executable);

    try {
      await waitForFile(childPidPath);
      const reviewerPid = Number(readFileSync(childPidPath, "utf8"));
      expect(processIsGone(reviewerPid)).toBe(false);
      executable.kill(signal);
      const result = await completion;

      expect(result.status, result.stderr).toBe(exitCode);
      expect(processIsGone(reviewerPid)).toBe(true);
      expect(readFileSync(eventsPath, "utf8").trim().split("\n")).toEqual([
        "workspace-cleanup:child-gone",
        `complete:${signal}`,
      ]);
    } finally {
      if (executable.exitCode === null && executable.signalCode === null)
        executable.kill("SIGKILL");
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
    timeoutMs: 5_000,
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
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
