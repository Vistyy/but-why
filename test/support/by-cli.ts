import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { Effect } from "effect";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { runCli, type CliResult } from "../../src/cli.js";
import { serializeOutput } from "../../src/output/serialize.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const byExecutable = join(repoRoot, "bin/by");

export const tempRoots: string[] = [];

export const runBy = (cwd: string, ...args: readonly string[]) => runByWithEnv(cwd, {}, ...args);

export const runByWithEnv = (cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]) =>
  spawnSync(byExecutable, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

export const runJustBy = (...args: readonly string[]) =>
  spawnSync("just", ["by", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

type InProcessCliResult = {
  readonly status: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
};

const cliResultToInProcessResult = (result: CliResult): InProcessCliResult => ({
  status: result.exitCode,
  stdout: serializeOutput(result.stdout, result.outputFormat ?? "toon"),
  stderr: "",
});

export const runByInProcess = (
  cwd: string,
  args: readonly string[],
  now = "2026-06-30T12:00:00.000Z",
): InProcessCliResult =>
  cliResultToInProcessResult(
    Effect.runSync(
      runCli(args, {
        executablePath: byExecutable,
        cwd,
        now: () => new Date(now),
      }),
    ),
  );

export const runByInProcessAsync = async (
  cwd: string,
  args: readonly string[],
  now = "2026-06-30T12:00:00.000Z",
): Promise<InProcessCliResult> =>
  cliResultToInProcessResult(
    await Effect.runPromise(
      runCli(args, {
        executablePath: byExecutable,
        cwd,
        now: () => new Date(now),
      }),
    ),
  );

export const runByInProcessArgs = (cwd: string, ...args: readonly string[]): InProcessCliResult =>
  runByInProcess(cwd, args);

export const createTempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "but-why-test-"));
  tempRoots.push(root);
  return root;
};

export const createGitRepo = () => {
  const root = createTempRoot();
  const result = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");

  return root;
};

export const cleanupTempRoots = () => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
};
