import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  builtByExecutable,
  byExecutable,
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runBuiltByWithEnv,
  runByInProcessEffect,
} from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";
const concurrentWriterCount = 2;

describe("by task CLI processes", () => {
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
            defaultAgentProfile: "test",
            agentProfiles: { test: { agentRuntime: "pi", agentModel: "test/model" } },
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
            validation: { checks: [{ id: "quality", command: "false" }] },
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
                "task",
                "create",
                "--title",
                `Concurrent ${index}`,
                "--description-file",
                `description-${index}.md`,
                "--output",
                "json",
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
          ["task", "show", "BY-2", "--output", "json"],
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
          ["change", "start", "--task", "BY-1", "--output", "json"],
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

        const submitted = runBuiltByWithEnv(
          root,
          processEnvironment,
          "change",
          "submit",
          change.change.id,
          "--output",
          "json",
        );
        expect(submitted.status).toBe(1);
        expect(JSON.parse(submitted.stdout)).toMatchObject({
          error: { code: "validation_findings", changeId: change.change.id },
        });

        const inspected = runBuiltByWithEnv(
          root,
          processEnvironment,
          "change",
          "show",
          change.change.id,
          "--output",
          "json",
        );
        expect(inspected.status).toBe(0);
        expect(JSON.parse(inspected.stdout)).toMatchObject({
          change: { id: change.change.id, taskId: "BY-1", state: "open" },
          currentValidationRun: { outcome: "blocked" },
        });
      }),
    30_000,
  );
});

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

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
    const child = spawn(process.execPath, [executable, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env,
        BUT_WHY_EXECUTABLE_PATH: byExecutable,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
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
