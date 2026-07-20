import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { createTestWorkspace } from "./testWorkspace.js";

import { runCli, type CliResult } from "../../src/cli.js";
import type { InteractiveSessionHost } from "../../src/change/interactiveSessionHost.js";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { LocalSubmitPreflight } from "../../src/localSubmit/submitPreflight.js";
import { serializeOutput } from "../../src/output/serialize.js";
import type { TaskUseCases } from "../../src/task/taskUseCases.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const byExecutable = join(repoRoot, "bin/by");

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

export const runJustBy = (...args: readonly string[]) => {
  const root = createGitRepo();

  writeFileSync(
    join(root, "justfile"),
    `set positional-arguments\n\n[no-exit-message]\nby *args:\n    @${byExecutable} "$@"\n`,
  );

  return spawnSync("just", ["by", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
};

type InProcessCliResult = {
  readonly status: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
};

type InProcessCliOptions = {
  readonly globalConfigPath?: string;
  readonly taskUseCases?: TaskUseCases;
  readonly submitPreflight?: LocalSubmitPreflight;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime;
  readonly interactiveSessionHost?: InteractiveSessionHost;
};

const cliResultToInProcessResult = (result: CliResult): InProcessCliResult => ({
  status: result.exitCode,
  stdout: serializeOutput(result.stdout, result.outputFormat ?? "toon"),
  stderr: "",
});

export const runByInProcessEffect = (
  cwd: string,
  args: readonly string[],
  now = "2026-06-30T12:00:00.000Z",
  options: InProcessCliOptions = {},
): Effect.Effect<InProcessCliResult> =>
  runCli(args, {
    executablePath: byExecutable,
    cwd,
    globalConfigPath: options.globalConfigPath ?? join(cwd, ".test-global-config.json"),
    now: () => new Date(now),
    ...(options.taskUseCases === undefined ? {} : { taskUseCases: options.taskUseCases }),
    ...(options.submitPreflight === undefined ? {} : { submitPreflight: options.submitPreflight }),
    ...(options.reviewerAgentRuntime === undefined
      ? {}
      : { reviewerAgentRuntime: options.reviewerAgentRuntime }),
    ...(options.interactiveSessionHost === undefined
      ? {}
      : { interactiveSessionHost: options.interactiveSessionHost }),
  }).pipe(Effect.map(cliResultToInProcessResult));

export const createGitRepo = () => {
  const root = createTestWorkspace();
  const result = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");

  return root;
};

export const commitButWhyConfigAndRecordDefault = (root: string): void => {
  runGit(root, "config", "user.name", "But Why Test");
  runGit(root, "config", "user.email", "but-why@example.test");
  runGit(root, "branch", "-M", "main");
  runGit(root, "add", ".but-why/config.json", ".gitignore");
  runGit(root, "commit", "-m", "Initialize But Why");
  runGit(root, "remote", "add", "origin", root);
  runGit(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  runGit(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
};

const runGit = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
};
