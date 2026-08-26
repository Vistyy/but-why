import {
  chmodSync,
  cpSync,
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
const observationDeadlineMs = 3_000;
const settlementDeadlineMs = 3_000;
const processTestDeadlineMs = 20_000;
const temporaryPaths: string[] = [];

type CommandResult = {
  status: number | null;
  output: string;
};

type StartedCommand = {
  readonly child: ReturnType<typeof startTestProcess>;
  readonly closed: boolean;
  readonly done: Promise<CommandResult>;
};

const signalProcessGroup = (process: StartedCommand, signal: NodeJS.Signals): void => {
  if (process.child.pid === undefined) {
    process.child.kill(signal);
    return;
  }
  try {
    globalThis.process.kill(-process.child.pid, signal);
  } catch {
    process.child.kill(signal);
  }
};

const stopProcess = async (process: StartedCommand, description: string): Promise<void> => {
  if (process.closed) return;
  signalProcessGroup(process, "SIGTERM");
  try {
    await settleWithinDeadline(process.done, description);
  } catch (error) {
    signalProcessGroup(process, "SIGKILL");
    await settleWithinDeadline(process.done, `${description} after SIGKILL`);
    throw error;
  }
};

const startRunner = (lockFile: string, args: string[]) => {
  const child = startTestProcess("bash", [runner, ...args], {
    cwd: dirname(lockFile),
    detached: true,
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
  let closed = false;
  const done = new Promise<CommandResult>((resolveResult) => {
    child.on("close", (status) => {
      closed = true;
      resolveResult({ status, output });
    });
  });
  return {
    child,
    get closed() {
      return closed;
    },
    done,
    get output() {
      return output;
    },
  };
};

const runRunner = async (
  lockFile: string,
  args: string[],
  description: string,
): Promise<CommandResult> => {
  const runnerProcess = startRunner(lockFile, args);
  try {
    return await settleWithinDeadline(runnerProcess.done, description);
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
  let closed = false;
  const done = new Promise<CommandResult>((resolveResult) => {
    child.on("close", (status) => {
      closed = true;
      resolveResult({ status, output });
    });
  });
  return {
    child,
    get closed() {
      return closed;
    },
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
    return await settleWithinDeadline(justProcess.done, "Just workload settlement");
  } finally {
    await stopJust(justProcess);
  }
};

const stopRunner = async (runnerProcess: ReturnType<typeof startRunner>): Promise<void> =>
  stopProcess(runnerProcess, "runner settlement after stop");

const signalJust = (justProcess: ReturnType<typeof startJust>, signal: NodeJS.Signals): void => {
  if (justProcess.child.pid === undefined) throw new Error("The Just process has no PID");
  process.kill(-justProcess.child.pid, signal);
};

const stopJust = async (justProcess: ReturnType<typeof startJust>): Promise<void> =>
  stopProcess(justProcess, "Just settlement after stop");

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
    timeoutMs: observationDeadlineMs,
  });

const settleWithinDeadline = <T>(promise: Promise<T>, description: string): Promise<T> =>
  observeUntil({
    description,
    observe: () => promise,
    timeoutMs: settlementDeadlineMs,
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

const waitForOutput = (process: { readonly output: string }, text: string): Promise<string> =>
  observeUntil({
    description: `quality process output to contain ${JSON.stringify(text)}`,
    observe: () => process.output,
    isReady: (output) => output.includes(text),
    timeoutMs: observationDeadlineMs,
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
  writeFileSync(pnpm, "#!/usr/bin/env bash\nexit 0\n");
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

describe("quality interface", { timeout: processTestDeadlineMs }, () => {
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
      expect(() => readFileSync(staticFile)).toThrow();
      expect(() => readFileSync(buildFile)).toThrow();
      expect(() => readFileSync(testFile)).toThrow();

      writeFileSync(releaseFile, "release");
      const result = await settleWithinDeadline(
        quality.done,
        "quality settlement after capacity release",
      );
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("quality completed in");
      expect(readFileSync(staticFile, "utf8")).toBe("static");
      expect(readFileSync(buildFile, "utf8")).toBe("build");
      expect(readFileSync(testFile, "utf8")).toBe("test");
    } finally {
      if (quality?.child.exitCode === null) await stopJust(quality);
      await stopRunner(holder);
    }
  });

  test("runs every quality phase after the first phase fails without reporting success", async () => {
    const failure = "static" as const;
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
      result = await settleWithinDeadline(quality.done, "failed quality settlement");
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

      const targeted = await runJust(lockFile, ["test", "test/cli/cli-task-id.test.ts"]);
      expect(targeted.status).toBe(0);

      writeFileSync(releaseFile, "release");
      const unselectedResult = await settleWithinDeadline(
        unselected.done,
        "unselected workload settlement after capacity release",
      );
      expect(unselectedResult.status, unselectedResult.output).toBe(0);
    } finally {
      if (unselected?.child.exitCode === null) await stopJust(unselected);
      await stopRunner(holder);
    }
  });

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
      waiter.child.kill("SIGTERM");
      expect(
        (await settleWithinDeadline(waiter.done, "interrupted waiting workload settlement")).status,
      ).toBe(143);
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

    const failed = await runRunner(
      lockFile,
      ["test", "sh", "-c", "exit 7"],
      "failed workload settlement",
    );
    expect(failed.status).toBe(7);

    const succeeded = await runRunner(
      lockFile,
      ["test", "sh", "-c", "exit 0"],
      "successful workload settlement",
    );
    expect(succeeded.status).toBe(0);
  });

  test("releases capacity only after controlled descendant cleanup", async () => {
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

    try {
      await waitForFile(readyFile);
      const descendantIdentity = await readProcessIdentity(descendantPidFile);
      const observer = startCleanupObserver(lockFile, descendantIdentity);
      await waitForOutput(observer, "waiting: cleanup observer is waiting for capacity");
      holder.child.kill("SIGINT");
      expect(
        (await settleWithinDeadline(holder.done, "interrupted descendant workload settlement"))
          .status,
      ).toBe(130);
      const observation = await settleWithinDeadline(
        observer.done,
        "capacity observer settlement after descendant cleanup",
      );
      expect(observation.status, observation.output).toBe(0);
      expect(observation.output).toContain("capacity acquired after descendant cleanup");
    } finally {
      await stopRunner(holder);
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

    try {
      await waitForFile(readyFile);
      await readProcessIdentity(descendantPidFile);
      const observer = startCapacityObserver(lockFile);
      await waitForOutput(observer, "waiting: capacity observer is waiting for capacity");
      signalJust(quality, signal);
      expect(
        (await settleWithinDeadline(quality.done, "interrupted quality settlement")).status,
      ).toBe(expectedStatus);
      expect(quality.output).toContain("quality interrupted after");
      expect(quality.output).toContain("rerun just quality to retry");
      expect(quality.output).not.toContain("quality completed in");
      const observation = await settleWithinDeadline(
        observer.done,
        "capacity observer settlement after quality interruption",
      );
      expect(observation.status, observation.output).toBe(0);
      expect(observation.output).toContain("capacity acquired after supervisor exit");
    } finally {
      await stopJust(quality);
    }
  });

  test("does not reacquire the lock for nested internal commands", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const nestedCommand = `${runner} 'nested internal' sh -c 'printf nested-success'`;
    const result = await runRunner(
      lockFile,
      ["test", "sh", "-c", nestedCommand],
      "nested workload settlement",
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain("nested-success");
  });
});
