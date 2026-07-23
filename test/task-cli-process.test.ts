import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { byExecutable, repoRoot } from "./support/by-cli.js";
import { createInitializedRepo } from "./support/initializedRepo.js";

const now = "2026-06-30T12:00:00.000Z";
const concurrentWriterCount = 3;

describe("by task CLI processes", () => {
  it("preserves Task state across concurrent CLI processes", async () => {
    const root = createInitializedRepo();
    const executable = builtCli();

    for (let index = 0; index < concurrentWriterCount; index += 1) {
      writeFileSync(join(root, `description-${index}.md`), `Description ${index}`);
    }

    const createResults = await Promise.all(
      Array.from({ length: concurrentWriterCount }, (_value, index) =>
        runByAsync(
          executable,
          root,
          { BUT_WHY_NOW: now },
          "task",
          "create",
          "--title",
          `Concurrent ${index}`,
          "--description-file",
          `description-${index}.md`,
        ),
      ),
    );
    expect(createResults.every((result) => result.status === 0)).toBe(true);

    writeFileSync(join(root, "comment-1.md"), "First concurrent comment");
    writeFileSync(join(root, "comment-2.md"), "Second concurrent comment");
    const commentResults = await Promise.all([
      runByAsync(
        executable,
        root,
        { BUT_WHY_NOW: now },
        "task",
        "comment",
        "BY-1",
        "--file",
        "comment-1.md",
      ),
      runByAsync(
        executable,
        root,
        { BUT_WHY_NOW: now },
        "task",
        "comment",
        "BY-1",
        "--file",
        "comment-2.md",
      ),
    ]);
    expect(commentResults.every((result) => result.status === 0)).toBe(true);

    const dependencyResults = await Promise.all([
      runByAsync(
        executable,
        root,
        {},
        "task",
        "dependencies",
        "set",
        "BY-3",
        "--depends-on",
        "BY-1",
      ),
      runByAsync(
        executable,
        root,
        {},
        "task",
        "dependencies",
        "set",
        "BY-3",
        "--depends-on",
        "BY-2",
      ),
    ]);
    expect(dependencyResults.every((result) => result.status === 0)).toBe(true);

    const [listed, context, shown] = await Promise.all([
      runByAsync(executable, root, {}, "task", "list", "--all", "--output", "json"),
      runByAsync(executable, root, {}, "task", "context", "BY-1"),
      runByAsync(executable, root, {}, "task", "show", "BY-3", "--output", "json"),
    ]);

    expect(
      (JSON.parse(listed.stdout) as { readonly tasks: readonly { readonly id: string }[] }).tasks
        .map((task) => task.id)
        .sort(),
    ).toEqual(["BY-1", "BY-2", "BY-3"]);
    expect(context.stdout).toContain("First concurrent comment");
    expect(context.stdout).toContain("Second concurrent comment");

    const prerequisites = (
      JSON.parse(shown.stdout) as {
        readonly task: { readonly prerequisites: readonly { readonly id: string }[] };
      }
    ).task.prerequisites;
    expect(prerequisites.map((task) => task.id)).toSatisfy(
      (ids: readonly string[]) => ids.join(",") === "BY-1" || ids.join(",") === "BY-2",
    );
  }, 30_000);
});

type AsyncCliResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const builtCli = (): string => {
  const executable = join(repoRoot, "dist/main.js");
  if (!existsSync(executable)) {
    const built = spawnSync("just", ["build"], { cwd: repoRoot, encoding: "utf8" });
    if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  }
  return executable;
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
