import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  builtByExecutable,
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  repoRoot,
} from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

const processTimeoutMs = 30_000;
const decodeEventObjects = (stdout: string): readonly Record<string, unknown>[] =>
  stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Pi emitted a non-object JSON event.");
      }
      return parsed as Record<string, unknown>;
    });

const eventType = (event: Record<string, unknown>): unknown => Reflect.get(event, "type");
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const runPi = (worktreePath: string, callsPath: string, sessionPath: string, path: string) =>
  runTestProcess(
    process.execPath,
    [
      join(repoRoot, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode",
      "json",
      "--print",
      "--session",
      sessionPath,
      "--offline",
      "--no-extensions",
      "--no-context-files",
      "--no-skills",
      "--thinking",
      "off",
      "--tools",
      "bash",
      "--model",
      "but-why-test/deterministic-tool",
      "--extension",
      join(repoRoot, "test/fixtures/pi/deterministic-tool-provider.mjs"),
      "--extension",
      join(repoRoot, "extensions/continue-change.ts"),
      "Change identity: BY-C1.",
    ],
    {
      cwd: worktreePath,
      env: { PI_TEST_PROVIDER_CALLS: callsPath, PATH: path },
      timeout: processTimeoutMs,
    },
  );

type ChangeEnvironment = {
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly inheritedPath: string;
  readonly runBy: (
    cwd: string,
    args: readonly string[],
    input?: string,
  ) => ReturnType<typeof runTestProcess>;
};

const createChangeEnvironment = (): ChangeEnvironment => {
  const repositoryRoot = createGitRepo();
  const candidateExecutable = builtByExecutable();
  const byDirectory = join(repositoryRoot, "by-bin");
  mkdirSync(byDirectory);
  const candidatePath = join(byDirectory, "by");
  writeFileSync(
    candidatePath,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(candidateExecutable)} "$@"\n`,
    { mode: 0o755 },
  );
  const inheritedPath = Reflect.get(process.env, "PATH");
  const path = `${byDirectory}:${typeof inheritedPath === "string" ? inheritedPath : ""}`;
  const runBy = (cwd: string, args: readonly string[], input?: string) =>
    runTestProcess(process.execPath, [candidateExecutable, ...args], {
      cwd,
      ...(input === undefined ? {} : { input }),
      timeout: processTimeoutMs,
    });
  const initialized = runBy(repositoryRoot, ["init", "--id-prefix", "BY"]);
  expect(initialized.status, initialized.stderr || initialized.stdout).toBe(0);
  commitButWhyConfigAndRecordDefault(repositoryRoot);

  const started = runBy(repositoryRoot, ["change", "start"]);
  expect(started.status, started.stderr || started.stdout).toBe(0);
  const startedValue: unknown = JSON.parse(started.stdout);
  if (typeof startedValue !== "object" || startedValue === null || Array.isArray(startedValue)) {
    throw new Error("Installed Change Start returned a non-object result.");
  }
  const worktreePath = Reflect.get(startedValue, "worktreePath");
  if (typeof worktreePath !== "string") throw new Error("Change Start omitted worktreePath.");
  return { repositoryRoot, worktreePath, inheritedPath: path, runBy };
};

const writeNoBlockerBy = (directory: string): string => {
  const path = join(directory, "by");
  const snapshot = JSON.stringify({
    change: {
      state: "open",
      closeReason: null,
      acceptanceContext: { version: 1, title: "Accepted", description: "Accepted." },
    },
    currentCandidate: null,
    currentValidationRun: null,
    findingCount: 0,
    toolingFailureCount: 0,
    pullRequest: null,
  });
  const blockerHistory = JSON.stringify({ blockers: [], resolutions: [], active: null });
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "change" ] && [ "$2" = "show" ]; then
  printf '%s\\n' ${shellQuote(snapshot)}
  exit 0
fi
if [ "$1" = "change" ] && [ "$2" = "blocker" ] && [ "$3" = "list" ]; then
  printf '%s\\n' ${shellQuote(blockerHistory)}
  exit 0
fi
exit 2
`,
    { mode: 0o755 },
  );
  return path;
};

describe("packaged Change Implement continuation extension process boundary", () => {
  it("continues a real Pi tool turn when blocker inspection reports no blocker", () => {
    const environment = createChangeEnvironment();
    const normalByDirectory = join(environment.repositoryRoot, "normal-by-bin");
    mkdirSync(normalByDirectory);
    writeNoBlockerBy(normalByDirectory);
    const path = `${normalByDirectory}:${environment.inheritedPath}`;
    const callsPath = join(environment.repositoryRoot, "normal-provider-calls.log");
    const run = runPi(
      environment.worktreePath,
      callsPath,
      join(environment.repositoryRoot, "normal-session.jsonl"),
      path,
    );

    expect(run.status, run.stderr || run.stdout).toBe(0);
    const events = decodeEventObjects(run.stdout);
    expect(events.filter((event) => eventType(event) === "tool_execution_end")).toHaveLength(1);
    expect(readFileSync(callsPath, "utf8").trim().split("\n").length).toBeGreaterThan(1);
  }, 30_000);

  it("aborts a real Pi turn after its tool batch when the installed Change is blocked", () => {
    const environment = createChangeEnvironment();
    const blocker = environment.runBy(
      environment.worktreePath,
      ["change", "blocker", "raise", "BY-C1", "--file", "-"],
      "The Operator must approve the implementation direction.\nContinuing without that decision is unsafe.\n",
    );
    expect(blocker.status, blocker.stderr || blocker.stdout).toBe(0);

    const callsPath = join(environment.repositoryRoot, "blocked-provider-calls.log");
    const sessionPath = join(environment.repositoryRoot, "blocked-session.jsonl");
    const run = runPi(environment.worktreePath, callsPath, sessionPath, environment.inheritedPath);

    expect(run.status, run.stderr || run.stdout).toBe(0);
    const events = decodeEventObjects(run.stdout);
    expect(events.filter((event) => eventType(event) === "tool_execution_end")).toHaveLength(1);
    expect(events.some((event) => eventType(event) === "turn_end")).toBe(true);
    expect(events.some((event) => eventType(event) === "agent_end")).toBe(true);
    expect(readFileSync(callsPath, "utf8").trim().split("\n")).toEqual(["1"]);
    const continuationEntries = decodeEventObjects(readFileSync(sessionPath, "utf8")).filter(
      (entry) => Reflect.get(entry, "customType") === "but-why-change-continuation",
    );
    const latestContinuation = continuationEntries.at(-1);
    expect(latestContinuation).toBeDefined();
    if (latestContinuation === undefined) throw new Error("Pi did not persist continuation state.");
    const continuationData = Reflect.get(latestContinuation, "data");
    if (typeof continuationData !== "object" || continuationData === null) {
      throw new Error("Pi persisted malformed continuation state.");
    }
    expect(Reflect.get(continuationData, "paused")).toBe(false);
  }, 30_000);
});
