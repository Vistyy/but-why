import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runner = join(repositoryRoot, "scripts/with-capacity-lock.sh");
const temporaryPaths: string[] = [];

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

const runVitest = (relativeFixture: string): Promise<CommandResult> =>
  new Promise<CommandResult>((resolveResult) => {
    const child = spawn(
      "pnpm",
      ["exec", "vitest", "run", "--config", "vitest.config.ts", relativeFixture],
      { cwd: repositoryRoot, env: process.env },
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

const waitForActiveWorkload = async (statusFile: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if (readFileSync(statusFile, "utf8").trim() !== "") return;
    } catch {
      // The runner has not acquired the lock yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("The capacity runner did not acquire its lock.");
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
    const holder = startRunner(lockFile, ["complete test", "sh", "-c", "sleep 2"]);

    await waitForActiveWorkload(`${lockFile}.status`);
    const contender = await runRunner(lockFile, ["complete coverage", "sh", "-c", "exit 0"]);

    expect(contender.status).toBe(1);
    expect(contender.output).toContain("active workload: complete test");
    expect(contender.output).toContain("running complete coverage");

    holder.child.kill("SIGTERM");
    await holder.done;
  });

  test("forwards child exit status and releases the lock after interruption", async () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-quality-lock-"));
    temporaryPaths.push(directory);
    const lockFile = join(directory, "capacity.lock");
    const failed = await runRunner(lockFile, ["complete test", "sh", "-c", "exit 7"]);

    expect(failed.status).toBe(7);

    const holder = startRunner(lockFile, ["complete coverage", "sh", "-c", "sleep 2"]);
    await waitForActiveWorkload(`${lockFile}.status`);
    holder.child.kill("SIGINT");
    expect((await holder.done).status).toBe(143);

    const recovered = await runRunner(lockFile, ["complete test", "sh", "-c", "exit 0"]);
    expect(recovered.status).toBe(0);
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
});
