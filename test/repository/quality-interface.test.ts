import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { observeUntil } from "../support/observe.js";
import { startTestProcess } from "../support/testProcess.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runner = join(repositoryRoot, "scripts/with-capacity-lock.sh");
const qualityRunner = join(repositoryRoot, "scripts/run-quality-workload.sh");
const temporaryPaths: string[] = [];
const processDeadlineMs = 5_000;
const qualityTestTimeoutMs = 30_000;

type CommandResult = {
  status: number | null;
  output: string;
};

type StartedCommand = {
  readonly child: { readonly exitCode: number | null };
  readonly done: Promise<CommandResult>;
};

const awaitProcessDone = (process: StartedCommand, description: string): Promise<CommandResult> =>
  observeUntil({
    description,
    observe: () => process.child.exitCode,
    isReady: (exitCode) => exitCode !== null,
    timeoutMs: processDeadlineMs,
  }).then(() => process.done);

const startRunner = (lockFile: string, args: string[]) => {
  const child = startTestProcess("bash", [runner, ...args], {
    cwd: dirname(lockFile),
    env: {
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
  return {
    child,
    done,
    get output() {
      return output;
    },
  };
};

const runRunner = async (lockFile: string, args: string[]): Promise<CommandResult> => {
  const runnerProcess = startRunner(lockFile, args);
  try {
    return await awaitProcessDone(runnerProcess, "runner process to exit");
  } finally {
    await stopRunner(runnerProcess);
  }
};

const startJust = (
  lockFile: string,
  args: string[],
  environment: NodeJS.ProcessEnv = {},
  cwd = dirname(lockFile),
) => {
  const child = startTestProcess("just", args, {
    cwd,
    detached: true,
    env: {
      BY_CAPACITY_LOCK_FILE: lockFile,
      BY_CAPACITY_LOCK_HELD: "0",
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
  return {
    child,
    done,
    get output() {
      return output;
    },
  };
};

const runJust = async (lockFile: string, args: string[]): Promise<CommandResult> => {
  const justProcess = startJust(lockFile, args, {
    PATH: `${dirname(lockFile)}:${process.env["PATH"] ?? ""}`,
  });
  try {
    return await awaitProcessDone(justProcess, "Just process to exit");
  } finally {
    await stopJust(justProcess);
  }
};

const stopRunner = async (runnerProcess: ReturnType<typeof startRunner>): Promise<void> => {
  if (runnerProcess.child.exitCode === null) runnerProcess.child.kill("SIGTERM");
  await awaitProcessDone(runnerProcess, "runner process cleanup");
};

const signalJust = (justProcess: ReturnType<typeof startJust>, signal: NodeJS.Signals): void => {
  if (justProcess.child.pid === undefined) throw new Error("The Just process has no PID");
  process.kill(-justProcess.child.pid, signal);
};

const stopJust = async (justProcess: ReturnType<typeof startJust>): Promise<void> => {
  if (justProcess.child.exitCode === null) signalJust(justProcess, "SIGTERM");
  await awaitProcessDone(justProcess, "Just process cleanup");
};

const runVitest = (fixtureRoot: string, fixture: string): Promise<CommandResult> => {
  const child = startTestProcess(
    join(repositoryRoot, "node_modules/.bin/vitest"),
    ["run", "--config", join(repositoryRoot, "vitest.config.ts"), "--root", fixtureRoot, fixture],
    { cwd: fixtureRoot },
  );
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
  const process = { child, done };
  return awaitProcessDone(process, "Vitest process to exit").finally(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await awaitProcessDone(process, "Vitest process cleanup");
  });
};

const waitForFile = (file: string): Promise<string> =>
  observeUntil({
    description: `file ${file} to contain its readiness handshake`,
    observe: () => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return "";
      }
    },
    isReady: (contents) => contents.trim() !== "",
    timeoutMs: 5_000,
  });

const processIdentity = (pid: number): string | undefined => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return undefined;
    const fieldsAfterCommand = stat.slice(commandEnd + 2).split(" ");
    const startTime = fieldsAfterCommand[19];
    return startTime === undefined ? undefined : `${pid}:${startTime}`;
  } catch {
    return undefined;
  }
};

const readProcessIdentity = async (pidFile: string): Promise<string> => {
  const pid = Number(await waitForFile(pidFile));
  const identity = processIdentity(pid);
  if (identity === undefined) throw new Error(`Descendant process ${pid} was not observable`);
  return identity;
};

const waitForProcessExit = (identity: string): Promise<boolean> =>
  observeUntil({
    description: `descendant process ${identity} to be reaped`,
    observe: () => {
      const pid = Number(identity.slice(0, identity.indexOf(":")));
      return processIdentity(pid) !== identity;
    },
    timeoutMs: 5_000,
  });

const waitForOutput = (process: { readonly output: string }, text: string): Promise<string> =>
  observeUntil({
    description: `quality process output to contain ${JSON.stringify(text)}`,
    observe: () => process.output,
    isReady: (output) => output.includes(text),
    timeoutMs: 5_000,
  });

const startCleanupObserver = (lockFile: string, identity: string) =>
  startRunner(lockFile, [
    "cleanup observer",
    process.execPath,
    "-e",
    `const fs = require("node:fs");
const identity = process.argv[1];
const separator = identity.indexOf(":");
const pid = identity.slice(0, separator);
let observed;
try {
  const stat = fs.readFileSync(\`/proc/\${pid}/stat\`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  const fields = commandEnd < 0 ? [] : stat.slice(commandEnd + 2).split(" ");
  observed = fields[19] === undefined ? undefined : \`\${pid}:\${fields[19]}\`;
} catch {}
if (observed === identity) process.exit(9);
process.stdout.write("capacity acquired after descendant cleanup");`,
    identity,
  ]);

const startCapacityObserver = (lockFile: string) =>
  startRunner(lockFile, [
    "capacity observer",
    "sh",
    "-c",
    'printf "capacity acquired after supervisor exit"',
  ]);

const createWorkloadJustfile = (directory: string): void => {
  cpSync(join(repositoryRoot, "package.json"), join(directory, "package.json"));
  symlinkSync(join(repositoryRoot, "node_modules"), join(directory, "node_modules"), "dir");
  symlinkSync(join(repositoryRoot, "scripts"), join(directory, "scripts"), "dir");
  writeFileSync(
    join(directory, "justfile"),
    `set positional-arguments := true

test *args:
    @exec ${JSON.stringify(join(repositoryRoot, "scripts/run-test-workload.sh"))} test "$@"

coverage *args:
    @exec ${JSON.stringify(join(repositoryRoot, "scripts/run-test-workload.sh"))} coverage "$@"
`,
  );
};

const createCompletingPnpm = (directory: string): void => {
  createWorkloadJustfile(directory);
  const pnpm = join(directory, "pnpm");
  writeFileSync(pnpm, "#!/usr/bin/env bash\nprintf '1 passed\\n'\nexit 0\n");
  chmodSync(pnpm, 0o755);
};

const createBlockingPnpm = (
  directory: string,
  readyFile: string,
  descendantPidFile: string,
): void => {
  createWorkloadJustfile(directory);
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

const createQualityFixture = (directory: string): void => {
  writeFileSync(
    join(directory, "justfile"),
    `quality:
    @exec ${JSON.stringify(qualityRunner)}


_quality-static:
    @true

build:
    @true

test:
    @pnpm exec vitest
`,
  );
};

const createObservableQualityFixture = (directory: string): void => {
  writeFileSync(
    join(directory, "justfile"),
    `quality:
    @exec ${JSON.stringify(qualityRunner)}

_quality-static:
    @printf static > "$QUALITY_STATIC_FILE"

build:
    @printf build > "$QUALITY_BUILD_FILE"

test:
    @printf test > "$QUALITY_TEST_FILE"
`,
  );
};

const createFailingQualityFixture = (directory: string): void => {
  writeFileSync(
    join(directory, "justfile"),
    `quality:
    @exec ${JSON.stringify(qualityRunner)}

_quality-static:
    @printf 'static\\n' >> "$QUALITY_INVOCATIONS"; if [ "$QUALITY_FAILURE" = "static" ]; then echo "static failure marker" >&2; exit 7; fi

build:
    @printf 'build\\n' >> "$QUALITY_INVOCATIONS"; if [ "$QUALITY_FAILURE" = "build" ]; then echo "build failure marker" >&2; exit 7; fi

test:
    @printf 'test\\n' >> "$QUALITY_INVOCATIONS"; if [ "$QUALITY_FAILURE" = "test" ]; then echo "test failure marker" >&2; exit 7; fi
`,
  );
};

const startHeldRunner = (lockFile: string, directory: string, workload: string) => {
  const readyFile = join(directory, "ready");
  const releaseFile = join(directory, "release");
  const holder = startRunner(lockFile, [
    workload,
    "sh",
    "-c",
    'printf ready > "$1"; while [ ! -f "$2" ]; do sleep 0.01; done',
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

describe("quality interface", { timeout: qualityTestTimeoutMs }, () => {
  test("waits before starting the quality workload", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const staticFile = join(directory, "static");
    const buildFile = join(directory, "build");
    const testFile = join(directory, "test");
    const { holder, readyFile, releaseFile } = startHeldRunner(lockFile, directory, "test");
    createObservableQualityFixture(directory);
    let quality: ReturnType<typeof startJust> | undefined;

    try {
      await waitForFile(readyFile);
      quality = startJust(
        lockFile,
        ["quality"],
        {
          QUALITY_STATIC_FILE: staticFile,
          QUALITY_BUILD_FILE: buildFile,
          QUALITY_TEST_FILE: testFile,
        },
        directory,
      );
      await waitForOutput(quality, "waiting: quality is waiting for capacity");

      expect(quality.child.exitCode).toBeNull();
      expect(quality.output).toContain("waiting: quality is waiting for capacity");
      expect(() => readFileSync(staticFile)).toThrow();
      expect(() => readFileSync(buildFile)).toThrow();
      expect(() => readFileSync(testFile)).toThrow();

      writeFileSync(releaseFile, "release");
      const result = await awaitProcessDone(quality, "quality process to exit");
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("quality completed in");
      expect(result.output).not.toContain("warning: quality exceeded");
      expect(readFileSync(staticFile, "utf8")).toBe("static");
      expect(readFileSync(buildFile, "utf8")).toBe("build");
      expect(readFileSync(testFile, "utf8")).toBe("test");
    } finally {
      if (quality !== undefined) await stopJust(quality);
      await stopRunner(holder);
    }
  });

  test.each([
    "static",
    "build",
    "test",
  ] as const)("forwards a %s failure with complete diagnostics and no success report", async (failure) => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-failure-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const invocationsFile = join(directory, "invocations");
    createFailingQualityFixture(directory);

    const quality = startJust(
      lockFile,
      ["quality"],
      {
        QUALITY_FAILURE: failure,
        QUALITY_INVOCATIONS: invocationsFile,
      },
      directory,
    );
    let result: CommandResult;
    try {
      result = await awaitProcessDone(quality, "quality failure process to exit");
    } finally {
      await stopJust(quality);
    }

    expect(result.status).toBe(1);
    expect(result.output).toContain(`${failure} failure marker`);
    expect(result.output).toContain("quality failed after");
    expect(result.output).not.toContain("quality completed in");
    const invocations = readFileSync(invocationsFile, "utf8").trim().split("\n");
    expect(invocations.filter((invocation) => invocation === "static")).toHaveLength(1);
    expect(invocations.filter((invocation) => invocation === "build")).toHaveLength(1);
    expect(invocations.filter((invocation) => invocation === "test")).toHaveLength(1);
  });

  test("waits for unselected workloads while targeted tests remain unlocked", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const { holder, readyFile, releaseFile } = startHeldRunner(lockFile, directory, "coverage");
    createCompletingPnpm(directory);
    let unselected: ReturnType<typeof startJust> | undefined;

    try {
      await waitForFile(readyFile);
      unselected = startJust(lockFile, ["test", "--reporter=dot"], {
        PATH: `${directory}:${process.env["PATH"] ?? ""}`,
      });
      await waitForOutput(unselected, "waiting: test is waiting for capacity");
      expect(unselected.child.exitCode).toBeNull();
      expect(unselected.output).toContain("waiting: test is waiting for capacity");

      const targeted = await runJust(lockFile, ["test", "test/cli/cli-task-id.test.ts"]);
      expect(targeted.status).toBe(0);
      expect(targeted.output).toContain("1 passed");

      writeFileSync(releaseFile, "release");
      const unselectedResult = await awaitProcessDone(
        unselected,
        "unselected test process to exit",
      );
      expect(unselectedResult.status, unselectedResult.output).toBe(0);
    } finally {
      if (unselected !== undefined) await stopJust(unselected);
      await stopRunner(holder);
    }
  }, 30_000);

  test("interrupts a workload while it waits for capacity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const acquiredFile = join(directory, "acquired");
    const { holder, readyFile, releaseFile } = startHeldRunner(lockFile, directory, "coverage");
    let waiter: ReturnType<typeof startRunner> | undefined;

    try {
      await waitForFile(readyFile);
      waiter = startRunner(lockFile, [
        "test",
        "sh",
        "-c",
        'printf acquired > "$1"',
        "sh",
        acquiredFile,
      ]);
      await waitForOutput(waiter, "waiting: test is waiting for capacity");
      expect(waiter.child.exitCode).toBeNull();
      expect(waiter.output).toContain("waiting: test is waiting for capacity");
      waiter.child.kill("SIGTERM");
      expect((await awaitProcessDone(waiter, "capacity waiter to exit")).status).toBe(143);
      expect(waiter.output).toContain("rerun the same command to retry");
      expect(() => readFileSync(acquiredFile)).toThrow();
    } finally {
      writeFileSync(releaseFile, "release");
      if (waiter !== undefined) await stopRunner(waiter);
      await stopRunner(holder);
    }
  });

  test("preserves normal workload success and failure status", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");

    const failed = await runRunner(lockFile, ["test", "sh", "-c", "exit 7"]);
    expect(failed.status).toBe(7);

    const succeeded = await runRunner(lockFile, ["test", "sh", "-c", "exit 0"]);
    expect(succeeded.status).toBe(0);
  });

  test("makes a bounded best-effort attempt to terminate one controlled descendant", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const readyFile = join(directory, "descendant-ready");
    const descendantPidFile = join(directory, "descendant-pid");
    const holder = startRunner(lockFile, [
      "test",
      "sh",
      "-c",
      'printf ready > "$1"; sleep 100 & descendant=$!; printf "$descendant" > "$2"; wait',
      "sh",
      readyFile,
      descendantPidFile,
    ]);
    let observer: ReturnType<typeof startRunner> | undefined;

    try {
      await waitForFile(readyFile);
      const descendantIdentity = await readProcessIdentity(descendantPidFile);
      observer = startCleanupObserver(lockFile, descendantIdentity);
      await waitForOutput(observer, "waiting: cleanup observer is waiting for capacity");
      holder.child.kill("SIGINT");
      expect((await awaitProcessDone(holder, "interrupted runner to exit")).status).toBe(130);
      const observation = await awaitProcessDone(observer, "cleanup observer to exit");
      expect(observation.status, observation.output).toBe(0);
      expect(observation.output).toContain("capacity acquired after descendant cleanup");
      await waitForProcessExit(descendantIdentity);
    } finally {
      if (observer !== undefined) await stopRunner(observer);
      await stopRunner(holder);
    }
  });

  test("does not let an unsupported detached descendant retain capacity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const workloadReadyFile = join(directory, "workload-ready");
    const daemonReadyFile = join(directory, "daemon-ready");
    const daemonPidFile = join(directory, "daemon-pid");
    const holder = startRunner(lockFile, [
      "test",
      "sh",
      "-c",
      '(setsid sh -c \'trap "" INT TERM; printf "$$" > "$1"; printf ready > "$2"; while :; do sleep 1; done\' sh "$2" "$3" >/dev/null 2>&1 &); printf ready > "$1"; while :; do sleep 1; done',
      "sh",
      workloadReadyFile,
      daemonPidFile,
      daemonReadyFile,
    ]);
    let daemonIdentity: string | undefined;
    let observer: ReturnType<typeof startRunner> | undefined;

    try {
      await waitForFile(workloadReadyFile);
      await waitForFile(daemonReadyFile);
      daemonIdentity = await readProcessIdentity(daemonPidFile);
      observer = startCapacityObserver(lockFile);
      await waitForOutput(observer, "waiting: capacity observer is waiting for capacity");
      holder.child.kill("SIGTERM");
      expect((await awaitProcessDone(holder, "interrupted runner to exit")).status).toBe(143);
      const observation = await awaitProcessDone(observer, "capacity observer to exit");
      expect(observation.status, observation.output).toBe(0);
      expect(observation.output).toContain("capacity acquired after supervisor exit");
      expect(processIdentity(Number(daemonIdentity?.split(":", 1)[0]))).toBe(daemonIdentity);
    } finally {
      if (observer !== undefined) await stopRunner(observer);
      const daemonToStop =
        daemonIdentity ??
        (existsSync(daemonPidFile)
          ? processIdentity(Number(readFileSync(daemonPidFile, "utf8")))
          : undefined);
      if (daemonToStop !== undefined) {
        const daemonPid = Number(daemonToStop.split(":", 1)[0]);
        if (processIdentity(daemonPid) === daemonToStop) process.kill(daemonPid, "SIGKILL");
        await waitForProcessExit(daemonToStop);
      }
      await stopRunner(holder);
    }
  });

  test("interrupts an actual unselected test workload with SIGINT and releases capacity", async () => {
    const signal = "SIGINT";
    const expectedStatus = 130;
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const readyFile = join(directory, "just-descendant-ready");
    const descendantPidFile = join(directory, "just-descendant-pid");
    createBlockingPnpm(directory, readyFile, descendantPidFile);
    const justProcess = startJust(lockFile, ["test"], {
      PATH: `${directory}:${process.env["PATH"] ?? ""}`,
    });
    let observer: ReturnType<typeof startRunner> | undefined;

    try {
      await waitForFile(readyFile);
      await readProcessIdentity(descendantPidFile);
      observer = startCapacityObserver(lockFile);
      await waitForOutput(observer, "waiting: capacity observer is waiting for capacity");
      signalJust(justProcess, signal);
      expect((await awaitProcessDone(justProcess, "interrupted Just process to exit")).status).toBe(
        expectedStatus,
      );
      expect(justProcess.output).toContain("rerun the same command to retry");
      const observation = await awaitProcessDone(observer, "capacity observer to exit");
      expect(observation.status, observation.output).toBe(0);
      expect(observation.output).toContain("capacity acquired after supervisor exit");
    } finally {
      if (observer !== undefined) await stopRunner(observer);
      await stopJust(justProcess);
    }
  });

  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("interrupts quality with %s and releases capacity", async (signal, expectedStatus) => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const readyFile = join(directory, "quality-ready");
    const descendantPidFile = join(directory, "quality-descendant-pid");
    createBlockingPnpm(directory, readyFile, descendantPidFile);
    createQualityFixture(directory);
    const quality = startJust(
      lockFile,
      ["quality"],
      {
        PATH: `${directory}:${process.env["PATH"] ?? ""}`,
      },
      directory,
    );
    let observer: ReturnType<typeof startRunner> | undefined;

    try {
      await waitForFile(readyFile);
      await readProcessIdentity(descendantPidFile);
      observer = startCapacityObserver(lockFile);
      await waitForOutput(observer, "waiting: capacity observer is waiting for capacity");
      signalJust(quality, signal);
      expect((await awaitProcessDone(quality, "interrupted quality process to exit")).status).toBe(
        expectedStatus,
      );
      expect(quality.output).toContain("quality interrupted after");
      expect(quality.output).toContain("rerun just quality to retry");
      expect(quality.output).not.toContain("quality completed in");
      const observation = await awaitProcessDone(observer, "capacity observer to exit");
      expect(observation.status, observation.output).toBe(0);
      expect(observation.output).toContain("capacity acquired after supervisor exit");
    } finally {
      if (observer !== undefined) await stopRunner(observer);
      await stopJust(quality);
    }
  });

  test("does not reacquire the lock for nested internal commands", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const nestedCommand = `${runner} 'nested internal' sh -c 'printf nested-success'`;
    const result = await runRunner(lockFile, ["test", "sh", "-c", nestedCommand]);

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
});
