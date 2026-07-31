import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { decode } from "@toon-format/toon";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  builtByExecutable,
  byExecutable,
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runBuiltByWithEnv,
  runBuiltByWithInput,
  runByInProcessEffect,
  testProcessEnvironment,
} from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";
import { runTestProcessOrThrow, startTestProcess } from "../support/testProcess.js";

const now = "2026-06-30T12:00:00.000Z";
const concurrentWriterCount = 2;

const expectExactlyOneTrailingLineFeed = (stdout: string): void => {
  const bytes = Buffer.from(stdout, "utf8");
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.at(-2)).not.toBe(0x0a);
};

describe("by task CLI processes", () => {
  it.each([
    ["root", ["--help", "--output", "json"], "Validate completed code changes"],
    ["group", ["task", "--help", "--output", "json"], "Manage repo-local Tasks"],
    ["leaf", ["task", "list", "--help", "--output", "json"], "List repo-local Tasks"],
  ] as const)("returns generated %s help in JSON", (_name, args, description) => {
    const result = runBuiltByWithEnv(createTestWorkspace(), {}, ...args);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).help).toContain(description);
  });

  it("returns the package version in the default TOON envelope", () => {
    const result = runBuiltByWithEnv(createTestWorkspace(), {}, "--version");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("version: 0.0.1\n");
  });

  it("returns the package version in JSON when output is selected first", () => {
    const result = runBuiltByWithEnv(createTestWorkspace(), {}, "--output", "json", "--version");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ version: "0.0.1" });
  });

  it("keeps JSON stdout structured when native logging is enabled", () => {
    const root = createGitRepo();
    const init = runBuiltByWithEnv(root, {}, "init", "--task-prefix", "BY");
    expect(init.status).toBe(0);

    const result = runBuiltByWithEnv(root, {}, "--log-level", "debug", "--output", "json");

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("level=");
    expect(result.stderr).toContain("level=");
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("terminates TOON and JSON success and error results with one line feed", () => {
    const root = createTestWorkspace();
    const cases = [
      { format: "toon", args: ["--output", "toon", "task", "--help"] as const, status: 0 },
      { format: "json", args: ["--output", "json", "task", "--help"] as const, status: 0 },
      { format: "toon", args: ["--output", "toon", "task", "--bad"] as const, status: 2 },
      { format: "json", args: ["--output", "json", "task", "--bad"] as const, status: 2 },
    ] as const;
    const results = cases.map(({ args }) => runBuiltByWithEnv(root, {}, ...args));

    for (const [index, result] of results.entries()) {
      expect(result.status, cases[index]?.format).toBe(cases[index]?.status);
      expect(result.stderr, cases[index]?.format).toBe("");
      expectExactlyOneTrailingLineFeed(result.stdout);
      expect(result.stdout.endsWith("\n\n"), cases[index]?.format).toBe(false);
      if (cases[index]?.format === "json") {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      } else {
        expect(() => decode(result.stdout)).not.toThrow();
      }
    }

    expect(decode(results[0]?.stdout ?? "")).toEqual(JSON.parse(results[1]?.stdout ?? ""));
    expect(decode(results[2]?.stdout ?? "")).toEqual(JSON.parse(results[3]?.stdout ?? ""));
  }, 120_000);

  it("reads piped UTF-8 stdin for Task descriptions and comments", () => {
    const root = createGitRepo();
    const initialized = runBuiltByWithEnv(root, {}, "init", "--task-prefix", "BY");
    expect(initialized.status).toBe(0);

    const created = runBuiltByWithInput(
      root,
      "Descripción exacta\n",
      {},
      "--output",
      "json",
      "task",
      "create",
      "--title",
      "Piped input",
      "--description-file",
      "-",
    );
    expect(created.status).toBe(0);

    const commented = runBuiltByWithInput(
      root,
      "Comentario exacto\n",
      {},
      "--output",
      "json",
      "task",
      "comment",
      "BY-1",
      "--file",
      "-",
    );
    expect(commented.status).toBe(0);

    const context = runBuiltByWithEnv(root, {}, "task", "context", "BY-1");
    expect(context.status).toBe(0);
    expect(context.stdout).toContain("Descripción exacta");
    expect(context.stdout).toContain("Comentario exacto");
  }, 30_000);

  it("preserves invalid UTF-8 stdin errors at the process boundary", () => {
    const root = createTestWorkspace();

    const invalid = runBuiltByWithInput(
      root,
      Buffer.from([0xff]),
      {},
      "--output",
      "json",
      "task",
      "create",
      "--title",
      "Invalid",
      "--description-file",
      "-",
    );
    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      error: { code: "invalid_description_encoding" },
    });
  }, 30_000);

  it.effect(
    "preserves Task state across concurrent CLI processes",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const executable = builtByExecutable();
        const home = createTestWorkspace();
        const globalConfigDirectory = join(home, ".config/but-why");
        mkdirSync(globalConfigDirectory, { recursive: true });
        writeFileSync(
          join(globalConfigDirectory, "config.json"),
          `${JSON.stringify({
            defaultAgentProfile: { scope: "global", name: "test" },
            agentProfiles: { test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } } },
          })}\n`,
        );
        const tools = createTestWorkspace();
        writeFileSync(
          join(tools, "gh"),
          `#!/usr/bin/env sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '{"defaultBranchRef":{"name":"main"}}\\n'
  exit 0
fi
if [ "$1" = "api" ]; then
  printf '[]\\n'
  exit 0
fi
exit 1
`,
        );
        chmodSync(join(tools, "gh"), 0o755);
        const processEnvironment: NodeJS.ProcessEnv = {
          BUT_WHY_NOW: now,
          HOME: home,
          // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
          PATH: `${tools}:${process.env["PATH"] ?? ""}`,
        };
        expect(
          runBuiltByWithEnv(root, processEnvironment, "init", "--task-prefix", "BY").status,
        ).toBe(0);
        writeFileSync(
          join(root, ".but-why/config.json"),
          `${JSON.stringify({
            taskPrefix: "BY",
            validation: { checks: [{ id: "quality", command: "sleep 10; false" }] },
          })}\n`,
        );
        commitButWhyConfigAndRecordDefault(root);
        git(root, "remote", "set-url", "origin", "https://github.com/acme/repo.git");

        for (let index = 0; index < concurrentWriterCount; index += 1) {
          writeFileSync(join(root, `description-${index}.md`), `Description ${index}`);
        }

        const createResults = yield* Effect.promise(() =>
          Promise.all(
            Array.from({ length: concurrentWriterCount }, (_value, index) =>
              runByAsync(
                executable,
                root,
                processEnvironment,
                "--output",
                "json",
                "task",
                "create",
                "--title",
                `Concurrent ${index}`,
                "--description-file",
                `description-${index}.md`,
              ),
            ),
          ),
        );
        expect(createResults.every((result) => result.status === 0)).toBe(true);

        writeFileSync(join(root, "comment-1.md"), "First concurrent comment");
        writeFileSync(join(root, "comment-2.md"), "Second concurrent comment");
        const commentResults = yield* Effect.promise(() =>
          Promise.all([
            runByAsync(
              executable,
              root,
              processEnvironment,
              "task",
              "comment",
              "BY-1",
              "--file",
              "comment-1.md",
            ),
            runByAsync(
              executable,
              root,
              processEnvironment,
              "task",
              "comment",
              "BY-1",
              "--file",
              "comment-2.md",
            ),
          ]),
        );
        expect(commentResults.every((result) => result.status === 0)).toBe(true);

        const dependencyResults = yield* Effect.promise(() =>
          Promise.all([
            runByAsync(
              executable,
              root,
              processEnvironment,
              "task",
              "dependencies",
              "set",
              "BY-2",
              "--depends-on",
              "BY-1",
            ),
            runByAsync(executable, root, processEnvironment, "task", "dependencies", "set", "BY-2"),
          ]),
        );
        expect(dependencyResults.every((result) => result.status === 0)).toBe(true);

        const createdTaskIds = createResults
          .map(
            (result) =>
              (JSON.parse(result.stdout) as { readonly task: { readonly id: string } }).task.id,
          )
          .sort();
        expect(createdTaskIds).toEqual(["BY-1", "BY-2"]);

        const context = yield* runByInProcessEffect(root, ["task", "context", "BY-1"], now);
        const shown = yield* runByInProcessEffect(
          root,
          ["--output", "json", "task", "show", "BY-2"],
          now,
        );
        expect(context.stdout).toContain("First concurrent comment");
        expect(context.stdout).toContain("Second concurrent comment");

        const prerequisites = (
          JSON.parse(shown.stdout) as {
            readonly task: { readonly prerequisites: readonly { readonly id: string }[] };
          }
        ).task.prerequisites;
        expect(prerequisites.map((task) => task.id)).toSatisfy(
          (ids: readonly string[]) => ids.length === 0 || ids.join(",") === "BY-1",
        );

        const approved = yield* runByInProcessEffect(root, ["task", "approve", "BY-1"], now);
        expect(approved.status).toBe(0);
        const started = yield* runByInProcessEffect(
          root,
          ["--output", "json", "change", "start", "--task", "BY-1"],
          now,
        );
        expect(started.status).toBe(0);
        const change = JSON.parse(started.stdout) as {
          readonly change: { readonly id: string };
          readonly worktreePath: string;
        };
        writeFileSync(join(change.worktreePath, "changed.txt"), "changed\n");
        git(change.worktreePath, "add", "changed.txt");
        git(
          change.worktreePath,
          "-c",
          "user.name=But Why Test",
          "-c",
          "user.email=but-why@example.test",
          "commit",
          "-m",
          "Add validated change",
        );

        const concurrentSubmissions = yield* Effect.promise(() =>
          Promise.all([
            runByAsync(
              executable,
              root,
              processEnvironment,
              "--output",
              "json",
              "change",
              "submit",
              change.change.id,
            ),
            runByAsync(
              executable,
              root,
              processEnvironment,
              "--output",
              "json",
              "change",
              "submit",
              change.change.id,
            ),
          ]),
        );
        const concurrentSubmissionCodes = concurrentSubmissions.map(
          (result) =>
            (JSON.parse(result.stdout) as { readonly error?: { readonly code?: string } }).error
              ?.code,
        );
        expect(concurrentSubmissionCodes).toContain("submission_in_progress");
        expect(concurrentSubmissionCodes).toContain("validation_findings");

        const runningSubmit = runByAsync(
          executable,
          root,
          processEnvironment,
          "--output",
          "json",
          "change",
          "submit",
          change.change.id,
        );
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 250)));
        const cancellation = yield* Effect.promise(() =>
          runByAsync(
            executable,
            root,
            processEnvironment,
            "--output",
            "json",
            "task",
            "cancel",
            "BY-1",
            "--reason",
            "Cancel during Submit.",
          ),
        );
        const runningSubmitResult = yield* Effect.promise(() => runningSubmit);
        expect(JSON.parse(cancellation.stdout)).toMatchObject({
          error: { code: "submission_in_progress", taskId: "BY-1" },
        });
        expect(JSON.parse(runningSubmitResult.stdout)).toMatchObject({
          error: { code: "validation_findings", changeId: change.change.id },
        });

        const toonSubmitted = runBuiltByWithEnv(
          root,
          processEnvironment,
          "change",
          "submit",
          change.change.id,
        );
        expect(toonSubmitted.status).toBe(1);
        expect(toonSubmitted.stdout).toContain("authority: change_submit");
        expect(toonSubmitted.stdout).toContain("action: fix_validation_findings");

        const submitted = runBuiltByWithEnv(
          root,
          processEnvironment,
          "--output",
          "json",
          "change",
          "submit",
          change.change.id,
        );
        expect(submitted.status).toBe(1);
        expect(JSON.parse(submitted.stdout)).toMatchObject({
          error: {
            code: "validation_findings",
            changeId: change.change.id,
            recovery: {
              authority: "change_submit",
              changeId: change.change.id,
              action: "fix_validation_findings",
              retryCommand: `by change submit ${change.change.id}`,
            },
          },
        });

        const interrupted = startTestProcess(
          process.execPath,
          [executable, "--output", "json", "change", "submit", change.change.id],
          {
            cwd: root,
            ...testProcessEnvironment({
              ...processEnvironment,
              BUT_WHY_EXECUTABLE_PATH: byExecutable,
            }),
          },
        );
        const interruptedExit = new Promise<number | null>((resolve) =>
          interrupted.once("close", (status) => resolve(status)),
        );
        const database = new DatabaseSync(join(root, ".git", "but-why", "state.sqlite"));
        database.exec("PRAGMA busy_timeout = 100");
        let interruptedRunId: string | undefined;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try {
            const active = database
              .prepare(
                "SELECT validation_run_id AS validationRunId FROM active_validation_runs WHERE change_id = ?",
              )
              .get(change.change.id) as { readonly validationRunId?: string } | undefined;
            if (active?.validationRunId !== undefined) {
              interruptedRunId = active.validationRunId;
              break;
            }
          } catch {
            // Another process is committing the active-run relation.
          }
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
        }
        database.close();
        expect(interruptedRunId).toBeDefined();
        interrupted.kill("SIGTERM");
        expect(yield* Effect.promise(() => interruptedExit)).not.toBe(0);
        const abandoned = runBuiltByWithEnv(
          root,
          processEnvironment,
          "--output",
          "json",
          "validation-run",
          "abandon",
          interruptedRunId ?? "",
          "--reason",
          "Submit process terminated.",
        );
        expect(abandoned.status).toBe(0);
        expect(JSON.parse(abandoned.stdout)).toMatchObject({
          validationRunId: interruptedRunId,
          status: "abandoned",
        });
        const resubmitted = runBuiltByWithEnv(
          root,
          processEnvironment,
          "--output",
          "json",
          "change",
          "submit",
          change.change.id,
        );
        expect(resubmitted.status).toBe(1);
        expect(JSON.parse(resubmitted.stdout)).toMatchObject({
          error: { code: "validation_findings", changeId: change.change.id },
        });

        const inspected = runBuiltByWithEnv(
          root,
          processEnvironment,
          "--output",
          "json",
          "change",
          "show",
          change.change.id,
        );
        expect(inspected.status).toBe(0);
        expect(JSON.parse(inspected.stdout)).toMatchObject({
          change: { id: change.change.id, taskId: "BY-1", state: "open" },
          currentValidationRun: { outcome: "blocked" },
        });

        writeFileSync(join(root, "blocker.md"), "Waiting for an external decision.\n");
        const blocked = runBuiltByWithEnv(
          root,
          processEnvironment,
          "--output",
          "json",
          "change",
          "blocker",
          "raise",
          change.change.id,
          "--file",
          "blocker.md",
        );
        expect(blocked.status).toBe(0);

        const submitBlocked = runBuiltByWithEnv(
          root,
          processEnvironment,
          "--output",
          "json",
          "change",
          "submit",
          change.change.id,
        );
        expect(submitBlocked.status).toBe(1);
        expect(JSON.parse(submitBlocked.stdout)).toEqual({
          error: {
            code: "change_blocked",
            message: "Change is blocked by an active Implementation Blocker.",
            changeId: change.change.id,
            blockerCommand: `by change blocker list ${change.change.id}`,
          },
          help: [
            `Inspect the existing Implementation Blocker with \`by change blocker list ${change.change.id}\`, then report it and wait.`,
          ],
        });
      }),
    120_000,
  );
});

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });

type AsyncCliResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const runByAsync = (
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: readonly string[]
): Promise<AsyncCliResult> =>
  new Promise((resolve, reject) => {
    const child = startTestProcess(process.execPath, [executable, ...args], {
      cwd,
      ...testProcessEnvironment({ ...env, BUT_WHY_EXECUTABLE_PATH: byExecutable }),
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout.push(chunk));
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) =>
      resolve({
        status,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      }),
    );
  });
