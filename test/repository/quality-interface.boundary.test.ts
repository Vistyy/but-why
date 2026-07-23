import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const runJust = (lockFile: string, args: string[]): Promise<CommandResult> =>
  new Promise<CommandResult>((resolveResult) => {
    const child = spawn("just", args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BY_CAPACITY_LOCK_FILE: lockFile,
        BY_CAPACITY_LOCK_HELD: "0",
        BY_TEST_SUITE: "",
      },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", (status) => resolveResult({ status, output }));
  });

const stopRunner = async (runnerProcess: ReturnType<typeof startRunner>): Promise<void> => {
  if (!runnerProcess.child.killed) runnerProcess.child.kill("SIGTERM");
  await runnerProcess.done;
};

const runVitest = (relativeFixture: string): Promise<CommandResult> =>
  new Promise<CommandResult>((resolveResult) => {
    const child = spawn(
      "pnpm",
      ["exec", "vitest", "run", "--config", "vitest.config.ts", relativeFixture],
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
  test("fails fast with the active complete workload", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const { holder, readyFile } = startHeldRunner(lockFile, directory, "complete test");

    try {
      await waitForFile(readyFile);
      const contender = await runRunner(lockFile, ["complete coverage", "sh", "-c", "exit 0"]);

      expect(contender.status).toBe(1);
      expect(contender.output).toContain("active workload: complete test");
      expect(contender.output).toContain("running complete coverage");
    } finally {
      await stopRunner(holder);
    }
  });

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
      expect((await holder.done).status).toBe(143);
    } finally {
      await stopRunner(holder);
    }

    const recovered = await runRunner(lockFile, ["complete test", "sh", "-c", "exit 0"]);
    expect(recovered.status).toBe(0);
  });

  test("terminates interrupted workload descendants before releasing the lock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const readyFile = join(directory, "descendant-ready");
    const holder = startRunner(lockFile, [
      "complete test",
      "sh",
      "-c",
      'printf ready > "$1"; sleep 100 & wait',
      "sh",
      readyFile,
    ]);

    try {
      await waitForFile(readyFile);
      holder.child.kill("SIGINT");
      expect((await holder.done).status).toBe(143);
    } finally {
      await stopRunner(holder);
    }

    const recovered = await runRunner(lockFile, ["complete coverage", "sh", "-c", "exit 0"]);
    expect(recovered.status).toBe(0);
  });

  test("locks complete option-bearing commands while leaving targeted tests unlocked", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const { holder, readyFile } = startHeldRunner(lockFile, directory, "complete coverage");

    try {
      await waitForFile(readyFile);
      const complete = await runJust(lockFile, ["test", "--reporter=dot"]);
      const targeted = await runJust(lockFile, ["test", "test/repository/module-seams.test.ts"]);

      expect(complete.status).toBe(1);
      expect(complete.output).toContain("active workload: complete coverage");
      expect(targeted.status).toBe(0);
      expect(targeted.output).toContain("1 passed");
    } finally {
      await stopRunner(holder);
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
    const suffix = `${process.pid}-${Date.now()}`;
    const failureFixture = join(repositoryRoot, "test", `.quality-failure-${suffix}.test.ts`);
    const successFixture = join(repositoryRoot, "test", `.quality-success-${suffix}.test.ts`);
    temporaryPaths.push(failureFixture, successFixture);
    writeFileSync(
      failureFixture,
      `import { expect, test } from "vitest";\n\ntest("retains controlled failure diagnostics", () => {\n  console.log("captured output marker");\n  expect({ actual: "value" }).toEqual({ actual: "different" });\n});\n`,
    );
    writeFileSync(
      successFixture,
      `import { expect, test } from "vitest";\n\ntest("successful output remains concise", () => {\n  expect(true).toBe(true);\n});\n`,
    );

    const failure = await runVitest(failureFixture.slice(`${repositoryRoot}/`.length));
    expect(failure.status).toBe(1);
    expect(failure.output).toContain("retains controlled failure diagnostics");
    expect(failure.output).toContain("captured output marker");
    expect(failure.output).toContain("- Expected");
    expect(failure.output).toContain("+ Received");
    expect(failure.output).toContain("AssertionError");

    const success = await runVitest(successFixture.slice(`${repositoryRoot}/`.length));
    expect(success.status).toBe(0);
    expect(success.output).toContain("Test Files");
    expect(success.output).not.toContain("✓ test/");
  });

  if (Reflect.get(process.env, "BY_VERIFY_QUALITY_COVERAGE") === "1") {
    test("coordinates complete and targeted coverage through Just", async () => {
      const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
      temporaryPaths.push(directory);
      const lockFile = join(directory, "capacity.lock");
      const { holder, readyFile } = startHeldRunner(lockFile, directory, "complete test");

      rmSync(coverageArtifact, { force: true });
      try {
        await waitForFile(readyFile);
        const complete = await runJust(lockFile, ["coverage", "--reporter=dot"]);
        const targeted = await runJust(lockFile, [
          "coverage",
          "test/repository/module-seams.test.ts",
        ]);

        expect(complete.status).toBe(1);
        expect(complete.output).toContain("active workload: complete test");
        expect(targeted.status).toBe(0);
        expect(targeted.output).not.toMatch(/All files|Statements| %/);
        expect(readFileSync(coverageArtifact, "utf8")).not.toBe("");
      } finally {
        await stopRunner(holder);
      }
    });
  }
});
