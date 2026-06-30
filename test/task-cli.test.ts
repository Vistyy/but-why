import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { collapseHome } from "../src/cli.js";
import {
  byExecutable,
  cleanupTempRoots,
  createGitRepo,
  createTempRoot,
  runByInProcess,
} from "./support/by-cli.js";

const expectedBin = collapseHome(byExecutable);
const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";

afterEach(cleanupTempRoots);

describe("by task CLI", () => {
  it("creates a todo Task with trimmed title, exact description, configured prefix, and summary output", () => {
    const root = initializedRepo();
    writeFileSync(join(root, "task.md"), "  Preserve me exactly.\n\n");

    const result = runByInProcess(
      root,
      ["task", "create", "--title", "  Add   login  ", "--description-file", "task.md"],
      firstNow,
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`task:
  id: BY-1
  title: Add   login
  state: todo
  createdAt: "${firstNow}"
  updatedAt: "${firstNow}"
help[1]: Run \`by task list\` to see open tasks.`);

    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      expect(database.prepare("SELECT * FROM tasks").all()).toEqual([
        {
          id: "BY-1",
          numeric_id: 1,
          title: "Add   login",
          description: "  Preserve me exactly.\n\n",
          state: "todo",
          created_at: firstNow,
          updated_at: firstNow,
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("resolves description files relative to cwd and allows files outside the repo", () => {
    const root = initializedRepo();
    const outsideRoot = createTempRoot();
    const outsideDescription = join(outsideRoot, "task.txt");

    writeFileSync(outsideDescription, "Outside description");

    const result = runByInProcess(
      root,
      ["task", "create", "--title", "Outside file", "--description-file", outsideDescription],
      firstNow,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("id: BY-1");
  });

  it("does not consume a Task ID when validation fails before insert", () => {
    const root = initializedRepo();
    writeFileSync(join(root, "task.md"), "Description");

    expect(
      runByInProcess(root, ["task", "create", "--title", "   ", "--description-file", "task.md"])
        .status,
    ).toBe(2);

    const result = runByInProcess(
      root,
      ["task", "create", "--title", "First valid", "--description-file", "task.md"],
      firstNow,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("id: BY-1");
  });

  it("lists non-done Tasks by default in creation order with count", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "First");
    createTask(root, secondNow, "Second");
    updateTaskState(root, "BY-2", "needs_input", thirdNow);

    const result = runByInProcess(root, ["task", "list"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`count: 2
tasks[2]{id,title,state,createdAt,updatedAt}:
  BY-1,First,todo,"${firstNow}","${firstNow}"
  BY-2,Second,needs_input,"${secondNow}","${thirdNow}"`);
  });

  it("uses numeric ID order when Tasks share the same creation timestamp", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "First");
    createTask(root, firstNow, "Second");

    expect(runByInProcess(root, ["task", "list"]).stdout).toBe(`count: 2
tasks[2]{id,title,state,createdAt,updatedAt}:
  BY-1,First,todo,"${firstNow}","${firstNow}"
  BY-2,Second,todo,"${firstNow}","${firstNow}"`);
  });

  it("supports --all and --state, with --state implying done visibility", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "First");
    createTask(root, secondNow, "Second");
    updateTaskState(root, "BY-1", "done", thirdNow);

    expect(runByInProcess(root, ["task", "list"]).stdout).toBe(`count: 1
tasks[1]{id,title,state,createdAt,updatedAt}:
  BY-2,Second,todo,"${secondNow}","${secondNow}"`);

    expect(runByInProcess(root, ["task", "list", "--all"]).stdout).toBe(`count: 2
tasks[2]{id,title,state,createdAt,updatedAt}:
  BY-1,First,done,"${firstNow}","${thirdNow}"
  BY-2,Second,todo,"${secondNow}","${secondNow}"`);

    expect(runByInProcess(root, ["task", "list", "--state", "done"]).stdout).toBe(`count: 1
tasks[1]{id,title,state,createdAt,updatedAt}:
  BY-1,First,done,"${firstNow}","${thirdNow}"`);
  });

  it("prints explicit empty list output with create help", () => {
    const root = initializedRepo();
    const result = runByInProcess(root, ["task", "list"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`count: 0
tasks: []
help[1]: "Run \`by task create --title \\"...\\" --description-file <file>\` to create a task."`);
  });

  it("prints bare dashboard with only actionable Tasks by priority and updated time", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Todo old");
    createTask(root, secondNow, "Ready");
    createTask(root, thirdNow, "Input");
    updateTaskState(root, "BY-2", "ready", secondNow);
    updateTaskState(root, "BY-3", "needs_input", firstNow);

    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      database
        .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("BY-4", 4, "Implementing", "Description", "implementing", firstNow, thirdNow);
      database
        .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("BY-5", 5, "Todo new", "Description", "todo", firstNow, thirdNow);
    } finally {
      database.close();
    }

    const result = runByInProcess(root, []);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
count: 4
tasks[4]{id,title,state,createdAt,updatedAt}:
  BY-3,Input,needs_input,"${thirdNow}","${firstNow}"
  BY-2,Ready,ready,"${secondNow}","${secondNow}"
  BY-5,Todo new,todo,"${firstNow}","${thirdNow}"
  BY-1,Todo old,todo,"${firstNow}","${firstNow}"`);
  });

  it("prints explicit empty dashboard output with create help", () => {
    const root = initializedRepo();
    const result = runByInProcess(root, []);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
count: 0
tasks: []
help[1]: "Run \`by task create --title \\"...\\" --description-file <file>\` to create a task."`);
  });

  it("prints structured usage errors to stdout", () => {
    const root = initializedRepo();
    const result = runByInProcess(root, ["task", "list", "--state", "blocked"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_task_state
  message: Unknown task state blocked.
  state: blocked
help[1]: "Use one of: todo, implementing, validating, needs_input, ready, done."`);
  });

  it.each([
    ["missing title", ["task", "create", "--description-file", "task.md"], "missing_title"],
    [
      "empty title",
      ["task", "create", "--title", "   ", "--description-file", "task.md"],
      "empty_title",
    ],
    [
      "missing description file",
      ["task", "create", "--title", "Title"],
      "missing_description_file",
    ],
  ])("prints %s as a usage error", (_name, args, code) => {
    const root = initializedRepo();
    writeFileSync(join(root, "task.md"), "Description");
    const result = runByInProcess(root, args);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`code: ${code}`);
    expect(result.stdout).toContain("help[1]");
  });

  it.each([
    ["not found", "missing.md", "description_file_not_found"],
    ["unreadable", "description-dir", "description_file_unreadable"],
    ["invalid UTF-8", "invalid.bin", "invalid_description_encoding"],
    ["too large", "large.txt", "description_too_large"],
    ["empty", "empty.txt", "empty_description"],
  ])("validates description file: %s", (_name, fileName, code) => {
    const root = initializedRepo();
    const filePath = join(root, fileName);

    if (fileName === "description-dir") {
      mkdirSync(filePath);
    } else if (fileName === "invalid.bin") {
      writeFileSync(filePath, Buffer.from([0xff]));
    } else if (fileName === "large.txt") {
      writeFileSync(filePath, "A".repeat(256 * 1024 + 1));
    } else if (fileName === "empty.txt") {
      writeFileSync(filePath, "  \n\t");
    }

    const result = runByInProcess(root, [
      "task",
      "create",
      "--title",
      "Title",
      "--description-file",
      fileName,
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`code: ${code}`);
    expect(result.stdout).toContain("help[1]");
  });

  it("prints not_initialized before task access to missing setup", () => {
    const root = createGitRepo();
    const result = runByInProcess(root, ["task", "list"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: not_initialized
  message: This workspace is not initialized for But Why?.
help[1]: Run \`by init --task-prefix BY\` in the repository root.`);
  });

  it("prints invalid_repo_config for malformed repo config", () => {
    const root = createGitRepo();

    mkdirSync(join(root, ".but-why"));
    writeFileSync(join(root, ".but-why/config.json"), "{");
    const result = runByInProcess(root, ["task", "list"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("code: invalid_repo_config");
    expect(result.stdout).toContain("help[1]");
  });

  it("serializes concurrent Task creation through SQLite", async () => {
    const root = initializedRepo();
    const createCount = 8;

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

    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      expect(
        database.prepare("SELECT id, numeric_id FROM tasks ORDER BY numeric_id").all(),
      ).toEqual(
        Array.from({ length: createCount }, (_value, index) => ({
          id: `BY-${index + 1}`,
          numeric_id: index + 1,
        })),
      );
    } finally {
      database.close();
    }
  });

  it("prints state_store_unavailable when repo state cannot be opened", () => {
    const root = initializedRepo();

    writeFileSync(join(root, ".but-why/state.sqlite"), "not sqlite");
    const result = runByInProcess(root, ["task", "list"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: state_store_unavailable
  message: Repo-local But Why? state is unavailable.
help[1]: "Move or restore .but-why/state.sqlite, then run \`by init --task-prefix BY\`."`);
  });

  it("creates task migration with required columns and constraints", () => {
    const root = initializedRepo();
    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      expect(database.prepare("SELECT name FROM schema_migrations ORDER BY name").all()).toEqual([
        { name: "001_init" },
        { name: "002_tasks" },
      ]);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ).toEqual([{ name: "schema_migrations" }, { name: "tasks" }]);
      expect(() =>
        database
          .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run("BY-1", 1, "Title", "Description", "blocked", firstNow, firstNow),
      ).toThrow();
    } finally {
      database.close();
    }
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();
  const result = runByInProcess(root, ["init", "--task-prefix", "BY"]);

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");

  return root;
};

const createTask = (root: string, now: string, title: string): void => {
  const descriptionPath = join(root, `${title}.md`);

  writeFileSync(descriptionPath, `Description for ${title}`);
  const result = runByInProcess(
    root,
    ["task", "create", "--title", title, "--description-file", descriptionPath],
    now,
  );

  expect(result.status).toBe(0);
};

const updateTaskState = (root: string, id: string, state: string, updatedAt: string): void => {
  const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

  try {
    database
      .prepare("UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?")
      .run(state, updatedAt, id);
  } finally {
    database.close();
  }
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
