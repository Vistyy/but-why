import { cpSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { onTestFinished } from "vitest";
import type { ReviewerAgentRuntime } from "../../src/agent/reviewerAgentRuntime.js";
import type { ReviewerOutput } from "../../src/agent/reviewerOutput.js";
import type { InteractiveSessionHost } from "../../src/change/interactiveSession/interactiveSessionHost.js";
import type { TextInputStdin } from "../../src/cli/input/textInput.js";
import { type CliResult, runCli } from "../../src/cli.js";
import { serializeOutput } from "../../src/output/serialize.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import type { TaskReviewerOutput } from "../../src/task/review/taskReviewerOutput.js";
import type { TaskSimplificationAdviceOutput } from "../../src/task/review/taskSimplificationAdviceOutput.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { TaskUseCases } from "../../src/task/taskUseCases.js";
import type { CancellationUseCases } from "../../src/taskChange/cancelTaskChange.js";
import type { TaskChangeTaskUseCases } from "../../src/taskChange/composition/loadTaskChangeTaskUseCases.js";
import { passTaskReviewFixture as passStoredTaskReviewFixture } from "./repository.js";
import { runTestProcess } from "./testProcess.js";
import { createTestWorkspace } from "./testWorkspace.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const byExecutable = "by";
const inProcessExecutablePath = join(repoRoot, "dist/main.js");

// Keep CLI process sentinels bounded without changing Vitest's global timeout.
const cliProcessTimeoutMs = 30_000;

export const testProcessEnvironment = (environment: NodeJS.ProcessEnv) => {
  const { HOME: isolatedHome, ...controlledEnvironment } = environment;
  return isolatedHome === undefined
    ? { env: controlledEnvironment }
    : { env: controlledEnvironment, isolatedHome };
};

let builtExecutable: string | undefined;

export const builtByExecutable = (): string => {
  if (builtExecutable !== undefined) return builtExecutable;

  const fixture = createTestWorkspace();
  cpSync(join(repoRoot, "src"), join(fixture, "src"), { recursive: true });
  cpSync(join(repoRoot, "package.json"), join(fixture, "package.json"));
  cpSync(join(repoRoot, "docs/public"), join(fixture, "docs/public"), { recursive: true });
  cpSync(join(repoRoot, "extensions"), join(fixture, "extensions"), { recursive: true });
  cpSync(join(repoRoot, "tsconfig.json"), join(fixture, "tsconfig.json"));
  cpSync(join(repoRoot, "tsconfig.build.json"), join(fixture, "tsconfig.build.json"));
  symlinkSync(join(repoRoot, "node_modules"), join(fixture, "node_modules"), "dir");
  const built = runTestProcess(
    join(repoRoot, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.build.json"],
    {
      cwd: fixture,
    },
  );
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);

  builtExecutable = join(fixture, "dist/main.js");
  onTestFinished(() => {
    builtExecutable = undefined;
  });
  return builtExecutable;
};

export const runBuiltByWithEnv = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: readonly string[]
) =>
  runTestProcess(process.execPath, [builtByExecutable(), ...args], {
    cwd,
    timeout: cliProcessTimeoutMs,
    ...testProcessEnvironment({ ...env, BUT_WHY_EXECUTABLE_PATH: byExecutable }),
  });

export const runBuiltByWithInput = (
  cwd: string,
  input: string | Buffer,
  env: NodeJS.ProcessEnv = {},
  ...args: readonly string[]
) =>
  runTestProcess(process.execPath, [builtByExecutable(), ...args], {
    cwd,
    input,
    timeout: cliProcessTimeoutMs,
    ...testProcessEnvironment({ ...env, BUT_WHY_EXECUTABLE_PATH: byExecutable }),
  });

export const runBy = (cwd: string, ...args: readonly string[]) => runByWithEnv(cwd, {}, ...args);

export const runByWithEnv = (cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]) =>
  runTestProcess(
    process.execPath,
    [
      "--import",
      join(repoRoot, "node_modules/tsx/dist/loader.mjs"),
      join(repoRoot, "src/main.ts"),
      ...args,
    ],
    {
      cwd,
      timeout: cliProcessTimeoutMs,
      ...testProcessEnvironment({ ...env, BUT_WHY_EXECUTABLE_PATH: byExecutable }),
    },
  );

export const runJustBy = (...args: readonly string[]) => {
  const root = createGitRepo();
  const candidateExecutable = builtByExecutable();

  writeFileSync(
    join(root, "justfile"),
    `set positional-arguments\n\n[no-exit-message]\nby *args:\n    @${process.execPath} ${candidateExecutable} "$@"\n`,
  );

  return runTestProcess("just", ["by", ...args], { cwd: root });
};

type InProcessCliResult = {
  readonly status: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
};

type InProcessCliOptions = {
  readonly globalConfigPath?: string;
  readonly stdin?: TextInputStdin;
  readonly taskUseCases?: TaskUseCases;
  readonly taskChangeTaskUseCases?: TaskChangeTaskUseCases;
  readonly cancellationUseCases?: CancellationUseCases;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  readonly taskReviewerAgentRuntime?: ReviewerAgentRuntime<TaskReviewerOutput>;
  readonly underengineerAgentRuntime?: ReviewerAgentRuntime<TaskSimplificationAdviceOutput>;
  readonly interactiveSessionHost?: InteractiveSessionHost;
  readonly writeStderr?: (message: string) => void;
};

const cliResultToInProcessResult = (result: CliResult): InProcessCliResult => ({
  status: result.exitCode,
  stdout: serializeOutput(result.stdout),
  stderr: "",
});

const runByInProcessEffectRaw = (
  cwd: string,
  args: readonly string[],
  now = "2026-06-30T12:00:00.000Z",
  options: InProcessCliOptions = {},
): Effect.Effect<InProcessCliResult> =>
  runCli(args, {
    executablePath: inProcessExecutablePath,
    cwd,
    globalConfigPath: options.globalConfigPath ?? join(cwd, ".test-global-config.json"),
    now: () => new Date(now),
    platform: "linux",
    stdin: options.stdin ?? { fd: -1, isTerminal: true },
    ...(options.taskUseCases === undefined ? {} : { taskUseCases: options.taskUseCases }),
    ...(options.taskChangeTaskUseCases === undefined
      ? {}
      : { taskChangeTaskUseCases: options.taskChangeTaskUseCases }),
    ...(options.cancellationUseCases === undefined
      ? {}
      : { cancellationUseCases: options.cancellationUseCases }),
    ...(options.reviewerAgentRuntime === undefined
      ? {}
      : { reviewerAgentRuntime: options.reviewerAgentRuntime }),
    ...(options.taskReviewerAgentRuntime === undefined
      ? {}
      : { taskReviewerAgentRuntime: options.taskReviewerAgentRuntime }),
    ...(options.underengineerAgentRuntime === undefined
      ? {}
      : { underengineerAgentRuntime: options.underengineerAgentRuntime }),
    ...(options.interactiveSessionHost === undefined
      ? {}
      : { interactiveSessionHost: options.interactiveSessionHost }),
    ...(options.writeStderr === undefined ? {} : { writeStderr: options.writeStderr }),
  }).pipe(Effect.map(cliResultToInProcessResult));

export const runByInProcessEffect = runByInProcessEffectRaw;

export const passTaskReviewFixture = (
  root: string,
  taskId: string,
  now = "2026-06-30T12:00:00.000Z",
) => {
  const loaded = openRepositoryRuntime(root);
  if (!loaded.ok) throw new Error(`Could not open Task fixture repository: ${loaded.error.code}`);
  return loaded.runtime.provide(
    passStoredTaskReviewFixture(loaded.runtime.context.root, publicTaskId(taskId), now),
  );
};

export const createGitRepo = (root = createTestWorkspace()) => {
  runGit(root, "init", "-q");
  return root;
};

export const commitButWhyConfigAndRecordDefault = (root: string): void => {
  runGit(root, "config", "user.name", "But Why Test");
  runGit(root, "config", "user.email", "but-why@example.test");
  runGit(root, "branch", "-M", "main");
  const configPath = join(root, ".but-why", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        validation: { checks: [{ id: "test", command: "true", timeoutSeconds: 30 }] },
      },
      null,
      2,
    )}\n`,
  );
  runGit(root, "add", ".but-why/config.json");
  runGit(root, "commit", "-m", "Initialize But Why");
  const publicationUrl = "https://github.com/acme/repo.git";
  runGit(root, "config", `url.${root}.insteadOf`, publicationUrl);
  runGit(root, "remote", "add", "origin", publicationUrl);
  runGit(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  runGit(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
};

const runGit = (cwd: string, ...args: readonly string[]): void => {
  const result = runTestProcess("git", args, { cwd });
  const command = `git ${args.join(" ")}`;
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  if (result.stderr !== "") throw new Error(`${command} wrote to stderr: ${result.stderr}`);
};
