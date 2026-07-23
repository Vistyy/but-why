import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { byExecutable, runByWithEnv } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const concurrentWriterCount = 4;

describe("by task CLI processes", () => {
  it("persists Task comments across CLI processes", async () => {
    const root = createInitializedRepo();

    createTask(root, firstNow, "Persistent comments");
    writeFileSync(join(root, "comment.md"), "Persist me exactly\n");

    const appendResult = await runByAsync(
      root,
      { BUT_WHY_NOW: secondNow },
      "task",
      "comment",
      "BY-1",
      "--file",
      "comment.md",
    );

    expect(appendResult.status).toBe(0);
    expect(appendResult.stderr).toBe("");
    expect(appendResult.stdout).toBe(`task:
  id: BY-1
  commentCount: 1`);

    const contextResult = await runByAsync(root, {}, "task", "context", "BY-1");
    expect(contextResult.stdout).toBe(`task:
  id: BY-1
  title: Persistent comments
  description: Description for Persistent comments
  comments[1]: "Persist me exactly\\n"`);
  }, 15_000);

  it("preserves all concurrent Task comment appends", async () => {
    const root = createInitializedRepo();
    const commentCount = concurrentWriterCount;

    createTask(root, firstNow, "Concurrent comments");

    for (let index = 0; index < commentCount; index += 1) {
      writeFileSync(join(root, `comment-${index}.md`), `Comment ${index}`);
    }

    const results = await Promise.all(
      Array.from({ length: commentCount }, (_value, index) =>
        runByAsync(
          root,
          { BUT_WHY_NOW: secondNow },
          "task",
          "comment",
          "BY-1",
          "--file",
          `comment-${index}.md`,
        ),
      ),
    );

    expect(results.every((result) => result.status === 0)).toBe(true);

    const contextResult = await runByAsync(root, {}, "task", "context", "BY-1");
    for (let index = 0; index < commentCount; index += 1) {
      expect(contextResult.stdout).toContain(`Comment ${index}`);
    }

    const showResult = await runByAsync(root, {}, "task", "show", "BY-1");
    expect(showResult.stdout).toContain(`commentCount: ${commentCount}`);
  }, 15_000);

  it("keeps concurrent Task dependency replacements atomic", async () => {
    const root = createInitializedRepo();
    createTask(root, firstNow, "First prerequisite");
    createTask(root, firstNow, "Second prerequisite");
    createTask(root, firstNow, "Third prerequisite");
    createTask(root, firstNow, "Dependent Task");

    const results = await Promise.all([
      runByAsync(root, {}, "task", "dependencies", "set", "BY-4", "--depends-on", "BY-1"),
      runByAsync(
        root,
        {},
        "task",
        "dependencies",
        "set",
        "BY-4",
        "--depends-on",
        "BY-2",
        "--depends-on",
        "BY-3",
      ),
    ]);

    expect(results.every((result) => result.status === 0)).toBe(true);
    const shown = await runByAsync(root, {}, "task", "show", "BY-4", "--output", "json");
    const prerequisites = (
      JSON.parse(shown.stdout) as {
        readonly task: { readonly prerequisites: readonly { readonly id: string }[] };
      }
    ).task.prerequisites;
    expect(prerequisites.map((task) => task.id)).toSatisfy(
      (ids: readonly string[]) => ids.join(",") === "BY-1" || ids.join(",") === "BY-2,BY-3",
    );
  }, 15_000);

  it("serializes concurrent Task creation through repo state", async () => {
    const root = createInitializedRepo();
    const createCount = concurrentWriterCount;

    for (let index = 0; index < createCount; index += 1) {
      writeFileSync(join(root, `concurrent-${index}.md`), `Description ${index}`);
    }

    const results = await Promise.all(
      Array.from({ length: createCount }, (_value, index) =>
        runByAsync(
          root,
          { BUT_WHY_NOW: firstNow },
          "task",
          "create",
          "--title",
          `Concurrent ${index}`,
          "--description-file",
          `concurrent-${index}.md`,
        ),
      ),
    );

    expect(results.every((result) => result.status === 0)).toBe(true);

    const listed = await runByAsync(root, {}, "task", "list", "--all", "--output", "json");
    expect(
      (
        JSON.parse(listed.stdout) as { readonly tasks: readonly { readonly id: string }[] }
      ).tasks.map((task) => task.id),
    ).toEqual(Array.from({ length: createCount }, (_value, index) => `BY-${index + 1}`));
  }, 15_000);
});

const createTask = (root: string, now: string, title: string): void => {
  const descriptionPath = join(root, ".task-description.md");
  writeFileSync(descriptionPath, `Description for ${title}`);
  const result = runByWithEnv(
    root,
    { BUT_WHY_NOW: now },
    "task",
    "create",
    "--title",
    title,
    "--description-file",
    descriptionPath,
  );
  if (result.status !== 0) throw new Error(result.stdout || result.stderr);
};

type AsyncCliResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const runByAsync = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: readonly string[]
): Promise<AsyncCliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(byExecutable, [...args], {
      cwd,
      env: {
        ...process.env,
        ...env,
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
