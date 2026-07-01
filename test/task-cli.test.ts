import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { collapseHome } from "../src/cli.js";
import type { TaskState } from "../src/task/task.js";
import { loadRepoTaskModule } from "../src/task/taskModule.js";
import { publicTaskId } from "../src/task/taskId.js";
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
const firstTaskStartNext = "Implement the task, then run by submit BY-1";
const firstTaskStartNextToon = `"${firstTaskStartNext}"`;

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
          branch: null,
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
    transitionTaskState(root, "BY-2", "needs_input", thirdNow);

    const result = runByInProcess(root, ["task", "list"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`count: 2
tasks[2]{id,title,state,createdAt,updatedAt}:
  BY-1,First,todo,"${firstNow}","${firstNow}"
  BY-2,Second,needs_input,"${secondNow}","${thirdNow}"`);
  });

  it("lists Tasks as compact JSON when selected after the command", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "First");
    createTask(root, secondNow, "Second");
    transitionTaskState(root, "BY-2", "needs_input", thirdNow);

    const result = runByInProcess(root, ["task", "list", "--output", "json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimEnd()).not.toContain("\n");
    expect(JSON.parse(result.stdout)).toEqual({
      count: 2,
      tasks: [
        {
          id: "BY-1",
          title: "First",
          state: "todo",
          createdAt: firstNow,
          updatedAt: firstNow,
        },
        {
          id: "BY-2",
          title: "Second",
          state: "needs_input",
          createdAt: secondNow,
          updatedAt: thirdNow,
        },
      ],
    });
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

  it("starts todo Tasks through the Task module idempotently", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Startable task");
    const taskModule = loadRepoTaskModule({ cwd: root, requireState: true });

    if (!taskModule.ok) {
      throw new Error(`Could not load Task module: ${taskModule.error.code}`);
    }

    const firstStart = taskModule.tasks.startTask(publicTaskId("BY-1"), secondNow);
    const secondStart = taskModule.tasks.startTask(publicTaskId("BY-1"), thirdNow);

    expect(firstStart).toMatchObject({ ok: true, changed: true });
    expect(secondStart).toMatchObject({ ok: true, changed: false });
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `state: implementing\n  createdAt: "${firstNow}"\n  updatedAt: "${secondNow}"`,
    );
  });

  it.each([
    "validating",
    "needs_input",
    "ready",
    "done",
  ] as const)("rejects %s Task starts through the Task module with public state errors", (state) => {
    const root = initializedRepo();

    createTask(root, firstNow, "Invalid start");
    transitionTaskState(root, "BY-1", state, secondNow);
    const taskModule = loadRepoTaskModule({ cwd: root, requireState: true });

    if (!taskModule.ok) {
      throw new Error(`Could not load Task module: ${taskModule.error.code}`);
    }

    expect(taskModule.tasks.startTask(publicTaskId("BY-1"), thirdNow)).toEqual({
      ok: false,
      code: "invalid_task_state",
      state,
    });
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `state: ${state}\n  createdAt: "${firstNow}"\n  updatedAt: "${secondNow}"`,
    );
  });

  it("starts todo Tasks from the CLI and persists the implementing state", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "CLI start");

    const result = runByInProcess(root, ["task", "start", "BY-1"], secondNow);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`task:
  id: BY-1
  state: implementing
  changed: true
  updatedAt: "${secondNow}"
next: ${firstTaskStartNextToon}`);
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `state: implementing\n  createdAt: "${firstNow}"\n  updatedAt: "${secondNow}"`,
    );
  });

  it("reports already implementing Task starts as no-ops without updating updatedAt", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "No-op start");
    transitionTaskState(root, "BY-1", "implementing", secondNow);

    const result = runByInProcess(root, ["task", "start", "BY-1"], thirdNow);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`task:
  id: BY-1
  state: implementing
  changed: false
  updatedAt: "${secondNow}"
next: ${firstTaskStartNextToon}`);
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `state: implementing\n  createdAt: "${firstNow}"\n  updatedAt: "${secondNow}"`,
    );
  });

  it("serializes Task start success as compact JSON", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "JSON start");

    const result = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], secondNow);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      task: {
        id: "BY-1",
        state: "implementing",
        changed: true,
        updatedAt: secondNow,
      },
      next: firstTaskStartNext,
    });
  });

  it("serializes invalid Task start errors as JSON", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Invalid JSON start");
    transitionTaskState(root, "BY-1", "ready", secondNow);

    const result = runByInProcess(root, ["task", "start", "BY-1", "--output", "json"], thirdNow);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      error: {
        code: "invalid_task_state",
        message: "Cannot start task BY-1 from state ready",
        taskId: "BY-1",
        state: "ready",
      },
      help: ["Review and merge the pull request."],
    });
  });

  it.each([
    ["validating", "Wait for validation to finish.", "Wait for validation to finish."],
    [
      "needs_input",
      "Address findings or add Task Context, then run by submit BY-1.",
      '"Address findings or add Task Context, then run by submit BY-1."',
    ],
    ["ready", "Review and merge the pull request.", "Review and merge the pull request."],
    ["done", "Task is already done.", "Task is already done."],
  ] as const)("rejects starting %s Tasks with state-specific help", (state, _help, toonHelp) => {
    const root = initializedRepo();

    createTask(root, firstNow, `Invalid ${state}`);
    transitionTaskState(root, "BY-1", state, secondNow);

    const result = runByInProcess(root, ["task", "start", "BY-1"], thirdNow);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: invalid_task_state
  message: Cannot start task BY-1 from state ${state}
  taskId: BY-1
  state: ${state}
help[1]: ${toonHelp}`);
    expect(result.stdout).not.toContain("invalid_task_state_transition");
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `state: ${state}\n  createdAt: "${firstNow}"\n  updatedAt: "${secondNow}"`,
    );
  });

  it("removes started Tasks from the default dashboard", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Started");
    expect(runByInProcess(root, ["task", "start", "BY-1"], secondNow).status).toBe(0);

    expect(runByInProcess(root, []).stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
count: 0
tasks: []
help[1]: "Run \`by task create --title \\"...\\" --description-file <file>\` to create a task."`);
  });

  it("rejects invalid Task state transitions through the Task module", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Invalid transition");
    const taskModule = loadRepoTaskModule({ cwd: root, requireState: true });

    if (!taskModule.ok) {
      throw new Error(`Could not load Task module: ${taskModule.error.code}`);
    }

    expect(
      taskModule.tasks.transitionTaskState({
        taskId: publicTaskId("BY-1"),
        to: "ready",
        now: secondNow,
      }),
    ).toEqual({
      ok: false,
      code: "invalid_task_state_transition",
      from: "todo",
      to: "ready",
    });
    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `state: todo\n  createdAt: "${firstNow}"\n  updatedAt: "${firstNow}"`,
    );
  });

  it("supports --all and --state, with --state implying done visibility", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "First");
    createTask(root, secondNow, "Second");
    transitionTaskState(root, "BY-1", "done", thirdNow);

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

  it("shows compact Task metadata without Task Context", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Inspect task");
    transitionTaskState(root, "BY-1", "needs_input", secondNow);

    const result = runByInProcess(root, ["task", "show", "BY-1"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`task:
  id: BY-1
  title: Inspect task
  state: needs_input
  createdAt: "${firstNow}"
  updatedAt: "${secondNow}"
  branch: null
  latestRun: null
  tokenTotals: null
  commentCount: 0`);
  });

  it("shows Task Context without metadata", () => {
    const root = initializedRepo();

    writeFileSync(join(root, "context.md"), "Full intent\n\nWith details.");
    const createResult = runByInProcess(root, [
      "task",
      "create",
      "--title",
      "Use context",
      "--description-file",
      "context.md",
    ]);

    expect(createResult.status).toBe(0);

    const result = runByInProcess(root, ["task", "context", "BY-1"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`task:
  id: BY-1
  title: Use context
  description: "Full intent\\n\\nWith details."
  comments: []`);
  });

  it("appends Task comments as ordered raw Task Context without changing state", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Commented task");
    transitionTaskState(root, "BY-1", "needs_input", secondNow);
    writeFileSync(join(root, "comment-1.md"), "First comment\n\nWith Markdown.\n");
    writeFileSync(join(root, "comment-2.md"), "First comment\n\nWith Markdown.\n");

    const firstResult = runByInProcess(
      root,
      ["task", "comment", "BY-1", "--file", "comment-1.md"],
      thirdNow,
    );
    const duplicateResult = runByInProcess(
      root,
      ["task", "comment", "BY-1", "--file", "comment-2.md"],
      "2026-06-30T12:15:00.000Z",
    );

    expect(firstResult.status).toBe(0);
    expect(firstResult.stderr).toBe("");
    expect(firstResult.stdout).toBe(`task:
  id: BY-1
  commentCount: 1`);
    expect(duplicateResult.status).toBe(0);
    expect(duplicateResult.stdout).toBe(`task:
  id: BY-1
  commentCount: 2`);

    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toBe(`task:
  id: BY-1
  title: Commented task
  state: needs_input
  createdAt: "${firstNow}"
  updatedAt: "2026-06-30T12:15:00.000Z"
  branch: null
  latestRun: null
  tokenTotals: null
  commentCount: 2`);
    expect(runByInProcess(root, ["task", "context", "BY-1"]).stdout).toBe(`task:
  id: BY-1
  title: Commented task
  description: Description for Commented task
  comments[2]: "First comment\\n\\nWith Markdown.\\n","First comment\\n\\nWith Markdown.\\n"`);
  });

  it("preserves a leading UTF-8 BOM in Task comment content", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "BOM comment");
    writeFileSync(join(root, "bom.md"), Buffer.from([0xef, 0xbb, 0xbf, 0x42, 0x4f, 0x4d]));

    const result = runByInProcess(root, ["task", "comment", "BY-1", "--file", "bom.md"], secondNow);

    expect(result.status).toBe(0);

    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      expect(database.prepare("SELECT content FROM task_comments").get()).toEqual({
        content: "\uFEFFBOM",
      });
    } finally {
      database.close();
    }
  });

  it("reports actionable Task comment input errors without changing the Task", () => {
    const root = initializedRepo();

    createTask(root, firstNow, "Input errors");
    writeFileSync(join(root, "valid.md"), "Valid comment");
    mkdirSync(join(root, "comment-dir"));
    writeFileSync(join(root, "empty.md"), " \n\t");
    writeFileSync(join(root, "invalid.bin"), Buffer.from([0xff]));

    const cases = [
      {
        name: "missing file flag",
        args: ["task", "comment", "BY-1"],
        status: 2,
        code: "missing_comment_file",
      },
      {
        name: "malformed task ID",
        args: ["task", "comment", "by-1", "--file", "valid.md"],
        status: 2,
        code: "invalid_task_id",
      },
      {
        name: "unknown task",
        args: ["task", "comment", "BY-999", "--file", "valid.md"],
        status: 1,
        code: "task_not_found",
      },
      {
        name: "unknown task before missing file",
        args: ["task", "comment", "BY-999", "--file", "missing.md"],
        status: 1,
        code: "task_not_found",
      },
      {
        name: "unknown task before stdin file",
        args: ["task", "comment", "BY-999", "--file", "-"],
        status: 1,
        code: "task_not_found",
      },
      {
        name: "missing file",
        args: ["task", "comment", "BY-1", "--file", "missing.md"],
        status: 1,
        code: "comment_file_not_found",
      },
      {
        name: "unreadable file",
        args: ["task", "comment", "BY-1", "--file", "comment-dir"],
        status: 1,
        code: "comment_file_unreadable",
      },
      {
        name: "invalid UTF-8",
        args: ["task", "comment", "BY-1", "--file", "invalid.bin"],
        status: 1,
        code: "comment_file_unreadable",
      },
      {
        name: "empty comment",
        args: ["task", "comment", "BY-1", "--file", "empty.md"],
        status: 1,
        code: "empty_comment",
      },
      {
        name: "stdin file",
        args: ["task", "comment", "BY-1", "--file", "-"],
        status: 1,
        code: "unsupported_stdin_comment_file",
      },
    ] as const;

    for (const testCase of cases) {
      const result = runByInProcess(root, testCase.args, thirdNow);

      expect(result.status, testCase.name).toBe(testCase.status);
      expect(result.stderr, testCase.name).toBe("");
      expect(result.stdout, testCase.name).toContain(`code: ${testCase.code}`);
      expect(result.stdout, testCase.name).toContain("help[1]");
    }

    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `updatedAt: "${firstNow}"`,
    );
    expect(runByInProcess(root, ["task", "context", "BY-1"]).stdout).toContain("comments: []");
  });

  it("persists Task comments across CLI processes", async () => {
    const root = initializedRepo();

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
    expect(runByInProcess(root, ["task", "context", "BY-1"]).stdout).toBe(`task:
  id: BY-1
  title: Persistent comments
  description: Description for Persistent comments
  comments[1]: "Persist me exactly\\n"`);
  });

  it("preserves all concurrent Task comment appends", async () => {
    const root = initializedRepo();
    const commentCount = 8;

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

    const database = new DatabaseSync(join(root, ".but-why/state.sqlite"));

    try {
      expect(
        database.prepare("SELECT content FROM task_comments ORDER BY sequence ASC").all(),
      ).toHaveLength(commentCount);
      expect(
        new Set(
          database
            .prepare("SELECT content FROM task_comments ORDER BY sequence ASC")
            .all()
            .map((row) => (row as { readonly content: string }).content),
        ),
      ).toEqual(
        new Set(Array.from({ length: commentCount }, (_value, index) => `Comment ${index}`)),
      );
    } finally {
      database.close();
    }

    expect(runByInProcess(root, ["task", "show", "BY-1"]).stdout).toContain(
      `commentCount: ${commentCount}`,
    );
  });

  it.each([
    "show",
    "context",
    "comment",
    "start",
  ])("validates Task ID arguments before %s lookup", (command) => {
    const root = createGitRepo();

    for (const [taskId, code] of [
      [undefined, "missing_task_id"],
      ["by-1", "invalid_task_id"],
      ["123", "invalid_task_id"],
      ["foo", "invalid_task_id"],
    ] as const) {
      const result = runByInProcess(
        root,
        taskId === undefined ? ["task", command] : ["task", command, taskId],
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`code: ${code}`);
      expect(result.stdout).toContain("help[1]");
    }
  });

  it.each([
    "show",
    "context",
    "start",
  ])("rejects wrong Task ID prefixes before state access in %s", (command) => {
    const root = initializedRepo();

    rmSync(join(root, ".but-why/state.sqlite"));
    const result = runByInProcess(root, ["task", command, "ZZ-1"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("code: invalid_task_id");
    expect(result.stdout).toContain("expectedFormat: BY-<number>");
  });

  it.each([
    "show",
    "context",
    "start",
  ])("prints task_not_found for unknown Task IDs in %s", (command) => {
    const root = initializedRepo();
    const result = runByInProcess(root, ["task", command, "BY-999"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`error:
  code: task_not_found
  message: "Task was not found: BY-999"
  taskId: BY-999
help[1]: Run \`by task list --all\` to see known Tasks.`);
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
    transitionTaskState(root, "BY-2", "ready", secondNow);
    transitionTaskState(root, "BY-3", "needs_input", firstNow);
    createTask(root, firstNow, "Implementing");
    transitionTaskState(root, "BY-4", "implementing", thirdNow);
    createTask(root, firstNow, "Todo new");
    writeFileSync(join(root, "todo-new-comment.md"), "Bump updated time");
    expect(
      runByInProcess(root, ["task", "comment", "BY-5", "--file", "todo-new-comment.md"], thirdNow)
        .status,
    ).toBe(0);

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
        { name: "003_task_comments" },
        { name: "004_submit_preflight" },
      ]);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "runs" },
        { name: "schema_migrations" },
        { name: "task_comments" },
        { name: "tasks" },
      ]);
      expect(() =>
        database
          .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run("BY-1", 1, "Title", "Description", "blocked", firstNow, firstNow, null),
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

const taskStateTransitionPaths = {
  todo: [],
  implementing: ["implementing"],
  validating: ["implementing", "validating"],
  needs_input: ["implementing", "validating", "needs_input"],
  ready: ["implementing", "validating", "ready"],
  done: ["implementing", "validating", "ready", "done"],
} satisfies Record<TaskState, readonly TaskState[]>;

const transitionTaskState = (
  root: string,
  id: string,
  state: TaskState,
  updatedAt: string,
): void => {
  const taskModule = loadRepoTaskModule({ cwd: root, requireState: true });

  if (!taskModule.ok) {
    throw new Error(`Could not load Task module: ${taskModule.error.code}`);
  }

  for (const nextState of taskStateTransitionPaths[state]) {
    const result = taskModule.tasks.transitionTaskState({
      taskId: publicTaskId(id),
      to: nextState,
      now: updatedAt,
    });

    if (!result.ok) {
      throw new Error(`Could not transition ${id} to ${nextState}: ${result.code}`);
    }
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
