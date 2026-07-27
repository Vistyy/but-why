import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runner = join(repositoryRoot, "scripts/with-capacity-lock.sh");
const temporaryPaths: string[] = [];
const coverageArtifact = join(repositoryRoot, "coverage/coverage-final.json");

type CommandResult = {
  status: number | null;
  output: string;
};

const startRunner = (lockFile: string, args: string[]) => {
  const child = spawn("bash", [runner, ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BY_CAPACITY_LOCK_FILE: lockFile,
      BY_CAPACITY_LOCK_HELD: "0",
    },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const done = new Promise<CommandResult>((resolveResult) => {
    child.on("close", (status) => resolveResult({ status, output }));
  });
  return { child, done };
};

const runRunner = (lockFile: string, args: string[]): Promise<CommandResult> =>
  startRunner(lockFile, args).done;

const startJust = (lockFile: string, args: string[], environment: NodeJS.ProcessEnv = {}) => {
  const child = spawn("just", args, {
    cwd: repositoryRoot,
    detached: true,
    env: {
      ...process.env,
      BY_CAPACITY_LOCK_FILE: lockFile,
      BY_CAPACITY_LOCK_HELD: "0",
      BY_TEST_SUITE: "routine",
      ...environment,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const done = new Promise<CommandResult>((resolveResult) => {
    child.on("close", (status) => resolveResult({ status, output }));
  });
  return { child, done };
};

const runJust = (lockFile: string, args: string[]): Promise<CommandResult> =>
  startJust(lockFile, args).done;

const stopRunner = async (runnerProcess: ReturnType<typeof startRunner>): Promise<void> => {
  if (runnerProcess.child.exitCode === null) runnerProcess.child.kill("SIGTERM");
  await runnerProcess.done;
};

const signalJust = (justProcess: ReturnType<typeof startJust>, signal: NodeJS.Signals): void => {
  if (justProcess.child.pid === undefined) throw new Error("The Just process has no PID");
  process.kill(-justProcess.child.pid, signal);
};

const stopJust = async (justProcess: ReturnType<typeof startJust>): Promise<void> => {
  if (justProcess.child.exitCode === null) signalJust(justProcess, "SIGTERM");
  await justProcess.done;
};

const runVitest = (fixtureRoot: string, fixture: string): Promise<CommandResult> =>
  new Promise<CommandResult>((resolveResult) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        join(repositoryRoot, "vitest.config.ts"),
        "--root",
        fixtureRoot,
        fixture,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, BY_TEST_SUITE: "" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", (status) => resolveResult({ status, output }));
  });

const waitForFile = async (file: string): Promise<void> => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      if (readFileSync(file, "utf8").trim() !== "") return;
    } catch {
      // The child has not reached the readiness handshake yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`The child did not reach its readiness handshake: ${file}`);
};

const waitForProcessExit = async (pidFile: string): Promise<void> => {
  const pid = Number(readFileSync(pidFile, "utf8"));
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`The descendant process is still running: ${pid}`);
};

const createBlockingPnpm = (
  directory: string,
  readyFile: string,
  descendantPidFile: string,
): void => {
  const pnpm = join(directory, "pnpm");
  writeFileSync(
    pnpm,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" exec vitest "* ]]; then
  printf ready > ${JSON.stringify(readyFile)}
  (trap '' INT TERM; while :; do sleep 1; done) &
  descendant=$!
  printf '%s' "$descendant" > ${JSON.stringify(descendantPidFile)}
  wait
fi
`,
  );
  chmodSync(pnpm, 0o755);
};

const startHeldRunner = (lockFile: string, directory: string, workload: string) => {
  const readyFile = join(directory, "ready");
  const releaseFile = join(directory, "release");
  const holder = startRunner(lockFile, [
    workload,
    "sh",
    "-c",
    'printf ready > "$1"; while [[ ! -f "$2" ]]; do sleep 0.01; done',
    "sh",
    readyFile,
    releaseFile,
  ]);
  return { holder, readyFile, releaseFile };
};

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("quality interface", () => {
  test("waits for complete workloads while targeted tests remain unlocked", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const { holder, readyFile, releaseFile } = startHeldRunner(
      lockFile,
      directory,
      "complete coverage",
    );
    let complete: ReturnType<typeof startJust> | undefined;

    try {
      await waitForFile(readyFile);
      complete = startJust(lockFile, ["test", "--reporter=dot"]);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      expect(complete.child.exitCode).toBeNull();

      const targeted = await runJust(lockFile, ["test", "test/repository/module-seams.test.ts"]);
      expect(targeted.status).toBe(0);
      expect(targeted.output).toContain("1 passed");

      writeFileSync(releaseFile, "release");
      const completeResult = await complete.done;
      expect(completeResult.status, completeResult.output).toBe(0);
    } finally {
      if (complete?.child.exitCode === null) {
        complete.child.kill("SIGTERM");
        await complete.done;
      }
      await stopRunner(holder);
    }
  }, 30_000);

  test("forwards child exit status and releases the lock after interruption", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const failed = await runRunner(lockFile, ["complete test", "sh", "-c", "exit 7"]);

    expect(failed.status).toBe(7);

    const { holder, readyFile } = startHeldRunner(lockFile, directory, "complete coverage");
    try {
      await waitForFile(readyFile);
      holder.child.kill("SIGINT");
      expect((await holder.done).status).toBe(130);
    } finally {
      await stopRunner(holder);
    }

    const recovered = await runRunner(lockFile, ["complete test", "sh", "-c", "exit 0"]);
    expect(recovered.status).toBe(0);
  });

  test("returns the conventional status for SIGTERM interruption", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const { holder, readyFile } = startHeldRunner(lockFile, directory, "complete test");

    try {
      await waitForFile(readyFile);
      holder.child.kill("SIGTERM");
      expect((await holder.done).status).toBe(143);
    } finally {
      await stopRunner(holder);
    }

    const recovered = await runRunner(lockFile, ["complete coverage", "sh", "-c", "exit 0"]);
    expect(recovered.status).toBe(0);
  });

  test("terminates interrupted workload descendants before releasing the lock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const readyFile = join(directory, "descendant-ready");
    const descendantPidFile = join(directory, "descendant-pid");
    const holder = startRunner(lockFile, [
      "complete test",
      "sh",
      "-c",
      'printf ready > "$1"; sleep 100 & descendant=$!; printf "$descendant" > "$2"; wait',
      "sh",
      readyFile,
      descendantPidFile,
    ]);

    try {
      await waitForFile(readyFile);
      await waitForFile(descendantPidFile);
      holder.child.kill("SIGINT");
      expect((await holder.done).status).toBe(130);
      await waitForProcessExit(descendantPidFile);
    } finally {
      await stopRunner(holder);
    }

    const recovered = await runRunner(lockFile, ["complete coverage", "sh", "-c", "exit 0"]);
    expect(recovered.status).toBe(0);
  });

  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("interrupts an actual Just test workload with %s and releases capacity", async (signal, expectedStatus) => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const readyFile = join(directory, "just-descendant-ready");
    const descendantPidFile = join(directory, "just-descendant-pid");
    createBlockingPnpm(directory, readyFile, descendantPidFile);
    const justProcess = startJust(lockFile, ["test"], {
      PATH: `${directory}:${Reflect.get(process.env, "PATH") ?? ""}`,
    });

    try {
      await waitForFile(readyFile);
      await waitForFile(descendantPidFile);
      const interruptedAt = Date.now();
      signalJust(justProcess, signal);
      expect((await justProcess.done).status).toBe(expectedStatus);
      expect(Date.now() - interruptedAt).toBeLessThan(3_000);
      const recovered = await runRunner(lockFile, ["complete coverage", "sh", "-c", "exit 0"]);
      expect(recovered.status).toBe(0);
      await waitForProcessExit(descendantPidFile);
    } finally {
      await stopJust(justProcess);
    }
  });

  test.each([
    ["quality", "SIGINT", 130],
    ["quality", "SIGTERM", 143],
    ["full-quality", "SIGINT", 130],
    ["full-quality", "SIGTERM", 143],
  ] as const)("interrupts the complete %s Just command with %s and releases its workload", async (qualityCommand, signal, expectedStatus) => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const readyFile = join(directory, `${qualityCommand}-ready`);
    const descendantPidFile = join(directory, `${qualityCommand}-descendant-pid`);
    createBlockingPnpm(directory, readyFile, descendantPidFile);
    const justProcess = startJust(lockFile, [qualityCommand], {
      PATH: `${directory}:${Reflect.get(process.env, "PATH") ?? ""}`,
    });

    try {
      await waitForFile(readyFile);
      await waitForFile(descendantPidFile);
      const interruptedAt = Date.now();
      signalJust(justProcess, signal);
      expect((await justProcess.done).status).toBe(expectedStatus);
      expect(Date.now() - interruptedAt).toBeLessThan(3_000);
      const recovered = await runRunner(lockFile, ["complete test", "sh", "-c", "exit 0"]);
      expect(recovered.status).toBe(0);
      await waitForProcessExit(descendantPidFile);
    } finally {
      await stopJust(justProcess);
    }
  });

  test("does not reacquire the lock for nested internal commands", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const nestedCommand = `${runner} 'nested internal' sh -c 'printf nested-success'`;
    const result = await runRunner(lockFile, ["complete test", "sh", "-c", nestedCommand]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("nested-success");
  });

  test("keeps successful output concise and failed diagnostics complete", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "but-why-quality-fixtures-"));
    temporaryPaths.push(fixtureRoot);
    const failureFixture = join(fixtureRoot, "quality-failure.test.ts");
    const successFixture = join(fixtureRoot, "quality-success.test.ts");
    writeFileSync(
      failureFixture,
      `import { expect, test } from "vitest";\n\ntest("retains controlled failure diagnostics", () => {\n  console.log("captured output marker");\n  expect({ actual: "value" }).toEqual({ actual: "different" });\n});\n`,
    );
    writeFileSync(
      successFixture,
      `import { expect, test } from "vitest";\n\ntest("successful output remains concise", () => {\n  expect(true).toBe(true);\n});\n`,
    );

    const failure = await runVitest(fixtureRoot, failureFixture);
    expect(failure.status).toBe(1);
    expect(failure.output).toContain("retains controlled failure diagnostics");
    expect(failure.output).toContain("captured output marker");
    expect(failure.output).toContain("- Expected");
    expect(failure.output).toContain("+ Received");
    expect(failure.output).toContain("AssertionError");

    const success = await runVitest(fixtureRoot, successFixture);
    expect(success.status).toBe(0);
    expect(success.output).toContain("Test Files");
    expect(success.output).not.toContain("✓ test/");
  });

  if (Reflect.get(process.env, "BY_VERIFY_QUALITY_COVERAGE") === "1") {
    test("waits for complete coverage while targeted coverage remains unlocked", async () => {
      const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
      temporaryPaths.push(directory);
      const lockFile = join(directory, "capacity.lock");
      const { holder, readyFile, releaseFile } = startHeldRunner(
        lockFile,
        directory,
        "complete test",
      );
      let complete: ReturnType<typeof startJust> | undefined;

      rmSync(coverageArtifact, { force: true });
      try {
        await waitForFile(readyFile);
        complete = startJust(lockFile, ["coverage", "--reporter=dot"]);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        expect(complete.child.exitCode).toBeNull();

        const targeted = await runJust(lockFile, [
          "coverage",
          "test/repository/module-seams.test.ts",
        ]);

        expect(targeted.status).toBe(0);
        expect(targeted.output).not.toMatch(/All files|Statements| %/);

        writeFileSync(releaseFile, "release");
        expect((await complete.done).status).toBe(0);
        expect(readFileSync(coverageArtifact, "utf8")).not.toBe("");
      } finally {
        if (complete?.child.exitCode === null) {
          complete.child.kill("SIGTERM");
          await complete.done;
        }
        await stopRunner(holder);
      }
    }, 30_000);
  }
});
