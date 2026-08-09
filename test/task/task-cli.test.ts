import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { collapseHome } from "../../src/cli/cliPath.js";
import { RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";
import type { TaskState } from "../../src/task/lifecycle.js";
import type { TaskRecord, TaskSummary } from "../../src/task/task.js";
import { byExecutable, createGitRepo, runByInProcessEffect } from "../support/by-cli.js";
import { fakeTaskUseCases } from "../support/taskUseCases.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const expectedBin = collapseHome(byExecutable);
const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";

describe("by task CLI", () => {
  it.effect("documents shared recording input for Task create in generated help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(createTestWorkspace(), [
        "--json",
        "task",
        "create",
        "--help",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const help = (JSON.parse(result.stdout) as { readonly help: string }).help;
      expect(help).toContain("regular UTF-8 text file path");
      expect(help).toContain("standard input");
    }),
  );

  it.effect(
    "creates a new Task with trimmed title, exact description, configured prefix, and summary output",
    () =>
      Effect.gen(function* () {
        const root = yield* initializedRepo();
        writeFileSync(join(root, "task.md"), "  Preserve me exactly.\n\n");

        const result = yield* runByInProcessEffect(
          root,
          ["task", "create", "--title", "  Add   login  ", "--file", "task.md"],
          firstNow,
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(`task:
  id: BY-1
  title: Add   login
  state: new
  createdAt: "${firstNow}"
  updatedAt: "${firstNow}"
  prerequisites: []
  dependents: []
  change: null
context:
  id: BY-1
  title: Add   login
  description: "  Preserve me exactly.\\n\\n"
help[1]: Run \`by task list\` to see open tasks.
`);
      }),
  );

  it.effect("maps approval success and unchanged approval to command output", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const task = taskRecord({ state: "todo", updatedAt: secondNow });
      let call = 0;
      const taskUseCases = fakeTaskUseCases({
        approveTask: () => {
          call += 1;
          return { ok: true as const, changed: call === 1, task };
        },
      });

      const firstApproval = yield* runByInProcessEffect(
        root,
        ["task", "approve", "BY-1"],
        secondNow,
        { taskUseCases },
      );
      const repeatedApproval = yield* runByInProcessEffect(
        root,
        ["task", "approve", "BY-1"],
        thirdNow,
        { taskUseCases },
      );

      expect(firstApproval.status).toBe(0);
      expect(firstApproval.stderr).toBe("");
      expect(firstApproval.stdout).toBe(`task:
  id: BY-1
  state: todo
  changed: true
  updatedAt: "${secondNow}"
`);
      expect(repeatedApproval.status).toBe(0);
      expect(repeatedApproval.stderr).toBe("");
      expect(repeatedApproval.stdout).toBe(`task:
  id: BY-1
  state: todo
  changed: false
  updatedAt: "${secondNow}"
`);
    }),
  );

  it.effect("maps rejected approval to the legal next action", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "approve", "BY-1"],
        thirdNow,
        {
          taskUseCases: fakeTaskUseCases({
            approveTask: () => ({ ok: false, code: "invalid_task_state", state: "done" }),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_task_state");
      expect(result.stdout).toContain("Cannot approve task BY-1 from state done");
      expect(result.stdout).toContain("Task is already done.");
    }),
  );

  it.effect("does not consume a Task ID when validation fails before insert", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      writeFileSync(join(root, "task.md"), "Description");

      expect(
        (yield* runByInProcessEffect(root, [
          "task",
          "create",
          "--title",
          "   ",
          "--file",
          "task.md",
        ])).status,
      ).toBe(2);

      const result = yield* runByInProcessEffect(
        root,
        ["task", "create", "--title", "First valid", "--file", "task.md"],
        firstNow,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("id: BY-1");
    }),
  );

  it.effect("renders Task List results with count", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const taskUseCases = fakeTaskUseCases({
        listTasks: () => ({
          tasks: [
            {
              id: "BY-1",
              title: "First",
              state: "new",
              createdAt: firstNow,
              updatedAt: firstNow,
              startable: false,
              blockedBy: [],
            },
            {
              id: "BY-2",
              title: "Second",
              state: "todo",
              createdAt: secondNow,
              updatedAt: thirdNow,
              startable: false,
              blockedBy: [],
            },
          ],
          total: 2,
        }),
      });

      const result = yield* runByInProcessEffect(root, ["task", "list"], firstNow, {
        taskUseCases,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`count: 2
total: 2
tasks[2]:
  - id: BY-1
    title: First
    state: new
    createdAt: "${firstNow}"
    updatedAt: "${firstNow}"
    blockedBy: []
    change: null
  - id: BY-2
    title: Second
    state: todo
    createdAt: "${secondNow}"
    updatedAt: "${thirdNow}"
    blockedBy: []
    change: null
`);
    }),
  );

  it.effect("renders bounded Task List results and reports truncation help", () =>
    Effect.gen(function* () {
      const tasks = Array.from({ length: 6 }, (_, index) =>
        taskSummary({ id: `BY-${index + 1}`, title: `Task ${index + 1}` }),
      );
      const doneTasks = Array.from({ length: 3 }, (_, index) =>
        taskSummary({ id: `BY-${index + 7}`, title: `Done ${index + 1}`, state: "done" }),
      );
      const taskUseCases = fakeTaskUseCases({
        listTasks: (input) => {
          const matching = input.state === "done" ? doneTasks : tasks;
          const limit = input.limit === "all" ? matching.length : (input.limit ?? matching.length);
          return { tasks: matching.slice(0, limit), total: matching.length };
        },
      });

      const defaultResult = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["--json", "task", "list"],
        firstNow,
        { taskUseCases },
      );
      const numericResult = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["--json", "task", "list", "--limit", "2"],
        firstNow,
        { taskUseCases },
      );
      const unlimitedResult = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["--json", "task", "list", "--limit", "all"],
        firstNow,
        { taskUseCases },
      );
      const filteredResult = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["--json", "task", "list", "--state", "done", "--limit", "2"],
        firstNow,
        { taskUseCases },
      );

      expect(JSON.parse(defaultResult.stdout)).toMatchObject({ count: 5, total: 6 });
      expect(JSON.parse(defaultResult.stdout).help[0]).toContain("--limit all");
      expect(JSON.parse(numericResult.stdout)).toMatchObject({ count: 2, total: 6 });
      expect(JSON.parse(numericResult.stdout).help[0]).toContain("--limit all");
      expect(JSON.parse(unlimitedResult.stdout)).toMatchObject({ count: 6, total: 6 });
      expect(JSON.parse(unlimitedResult.stdout).help).toBeUndefined();
      expect(JSON.parse(filteredResult.stdout)).toMatchObject({ count: 2, total: 3 });
      expect(JSON.parse(filteredResult.stdout).help[0]).toBe(
        "Run `by task list --state done --limit all` to retrieve all matching Tasks.",
      );
    }),
  );

  it.effect("rejects an invalid Task List limit without reading state", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["--json", "task", "list", "--limit", "0"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            listTasks: () => {
              throw new Error("Task List must not read state for an invalid limit");
            },
          }),
        },
      );

      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: {
          code: "invalid_task_list_limit",
          message: "Task list limit must be a positive integer or `all`.",
        },
      });
    }),
  );

  it.effect("serializes Task List summaries as compact JSON", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["--json", "task", "list"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            listTasks: () => ({ tasks: compactJsonTasks, total: compactJsonTasks.length }),
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trimEnd()).not.toContain("\n");
      expect(JSON.parse(result.stdout)).toEqual({
        count: 2,
        total: 2,
        tasks: compactJsonTasks.map(({ startable: _startable, ...task }) => ({
          ...task,
          change: null,
        })),
      });
    }),
  );

  it.effect("supports --all and --state, with --state implying done visibility", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const inputs: Array<{ readonly includeDone: boolean; readonly state?: TaskState }> = [];
      const taskUseCases = fakeTaskUseCases({
        listTasks: (input) => {
          inputs.push(input);
          return { tasks: compactJsonTasks, total: compactJsonTasks.length };
        },
      });

      yield* runByInProcessEffect(root, ["--json", "task", "list"], firstNow, {
        taskUseCases,
      });
      yield* runByInProcessEffect(root, ["--json", "task", "list", "--all"], firstNow, {
        taskUseCases,
      });
      yield* runByInProcessEffect(root, ["--json", "task", "list", "--state", "done"], firstNow, {
        taskUseCases,
      });

      expect(inputs).toEqual([
        { includeDone: false, limit: 5 },
        { includeDone: true, limit: 5 },
        { includeDone: true, state: "done", limit: 5 },
      ]);
    }),
  );

  it.effect("shows compact Task metadata with Task Context expansion", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "show", "BY-1"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            getTaskById: () =>
              taskRecord({ title: "Inspect task", state: "todo", updatedAt: secondNow }),
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`task:
  id: BY-1
  title: Inspect task
  state: todo
  createdAt: "${firstNow}"
  updatedAt: "${secondNow}"
  prerequisites: []
  dependents: []
  change: null
contextCommand: by task context BY-1
`);
    }),
  );

  it.effect("shows Task Context without metadata", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "context", "BY-1"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            getTaskContextById: () => ({
              id: "BY-1",
              title: "Use context",
              description: "Full intent\n\nWith details.",
            }),
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`task:
  id: BY-1
  title: Use context
  description: "Full intent\\n\\nWith details."
`);
    }),
  );

  it.effect("creates a managed Task Context draft with the current title and description", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();

      yield* createTask(root, firstNow, "Draft title");

      const result = yield* runByInProcessEffect(root, [
        "--json",
        "task",
        "context",
        "draft",
        "BY-1",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");

      const output = JSON.parse(result.stdout) as {
        draft: { path: string; content: string };
      };

      expect(output.draft.path).toMatch(
        /\.git\/but-why\/task-context-drafts\/by-1-[a-f0-9]{12}\.md$/,
      );
      expect(output.draft.content).toBe("# Draft title\n\nDescription for Draft title");
      expect(existsSync(output.draft.path)).toBe(true);
      expect(readFileSync(output.draft.path, "utf8")).toBe(output.draft.content);
    }),
  );

  it.effect("reports unavailable state when a Task Context draft cannot be written", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();
      yield* createTask(root, firstNow, "Blocked draft");
      writeFileSync(join(root, ".git", "but-why", "task-context-drafts"), "not a directory");

      const result = yield* runByInProcessEffect(root, [
        "--json",
        "task",
        "context",
        "draft",
        "BY-1",
      ]);

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: "state_store_unavailable" },
      });
    }),
  );

  it.effect("replaces a prior Task Context draft with current Task Context", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();

      yield* createTask(root, firstNow, "Original title");
      const firstDraft = JSON.parse(
        (yield* runByInProcessEffect(root, ["--json", "task", "context", "draft", "BY-1"])).stdout,
      ) as { draft: { path: string } };
      writeFileSync(firstDraft.draft.path, "# Current title\n\nCurrent description");
      expect(
        (yield* runByInProcessEffect(root, ["task", "context", "apply", "BY-1"], secondNow)).status,
      ).toBe(0);

      const draftResult = yield* runByInProcessEffect(root, [
        "--json",
        "task",
        "context",
        "draft",
        "BY-1",
      ]);
      const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
      writeFileSync(draft.draft.path, "Discard this draft");

      expect((yield* runByInProcessEffect(root, ["task", "context", "draft", "BY-1"])).status).toBe(
        0,
      );
      expect(draft.draft.path).toBe(firstDraft.draft.path);
      expect(readFileSync(draft.draft.path, "utf8")).toBe("# Current title\n\nCurrent description");
    }),
  );

  it.effect("applies a valid Task Context draft before Change Start and removes it", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();

      yield* createTask(root, firstNow, "Original title");

      const draftResult = yield* runByInProcessEffect(root, [
        "--json",
        "task",
        "context",
        "draft",
        "BY-1",
      ]);
      const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
      writeFileSync(draft.draft.path, "#  Updated title  \n\nUpdated description\n\n");

      const result = yield* runByInProcessEffect(
        root,
        ["--json", "task", "context", "apply", "BY-1"],
        secondNow,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        task: {
          id: "BY-1",
          title: "Updated title",
          state: "new",
          updatedAt: secondNow,
          change: null,
        },
        context: {
          id: "BY-1",
          title: "Updated title",
          description: "Updated description\n\n",
        },
      });
      expect(existsSync(draft.draft.path)).toBe(false);
      expect((yield* runByInProcessEffect(root, ["task", "context", "BY-1"])).stdout).toContain(
        'title: Updated title\n  description: "Updated description\\n\\n"',
      );
    }),
  );

  it.effect("retains an invalid Task Context draft without changing the Task", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();

      yield* createTask(root, firstNow, "Original title");

      const draftResult = yield* runByInProcessEffect(root, [
        "--json",
        "task",
        "context",
        "draft",
        "BY-1",
      ]);
      const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
      writeFileSync(draft.draft.path, "Updated title\n\nUpdated description");

      const result = yield* runByInProcessEffect(
        root,
        ["task", "context", "apply", "BY-1"],
        secondNow,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_task_context_draft");
      expect(existsSync(draft.draft.path)).toBe(true);
      expect((yield* runByInProcessEffect(root, ["task", "context", "BY-1"])).stdout).toContain(
        "title: Original title\n  description: Description for Original title",
      );
    }),
  );

  it.effect("retains a Task Context draft without its required blank-line separator", () =>
    Effect.gen(function* () {
      const root = yield* initializedRepo();

      yield* createTask(root, firstNow, "Original title");
      const draftResult = yield* runByInProcessEffect(root, [
        "--json",
        "task",
        "context",
        "draft",
        "BY-1",
      ]);
      const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
      writeFileSync(draft.draft.path, "# Updated title\nUpdated description");

      const result = yield* runByInProcessEffect(
        root,
        ["task", "context", "apply", "BY-1"],
        secondNow,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: invalid_task_context_draft");
      expect(existsSync(draft.draft.path)).toBe(true);
      expect((yield* runByInProcessEffect(root, ["task", "context", "BY-1"])).stdout).toContain(
        "title: Original title\n  description: Description for Original title",
      );
    }),
  );

  it.effect.each(["done", "cancelled"] as const)(
    "retains Task Context drafts when applying to a %s Task",
    (state) =>
      Effect.gen(function* () {
        const root = yield* initializedRepo();

        yield* createTask(root, firstNow, "Original title");
        const draftResult = yield* runByInProcessEffect(root, [
          "--json",
          "task",
          "context",
          "draft",
          "BY-1",
        ]);
        const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
        writeFileSync(draft.draft.path, "# Updated title\n\nUpdated description");
        yield* setTaskState(root, "BY-1", state, secondNow);

        const result = yield* runByInProcessEffect(
          root,
          ["task", "context", "apply", "BY-1"],
          thirdNow,
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("code: invalid_task_state");
        expect(existsSync(draft.draft.path)).toBe(true);
        expect((yield* runByInProcessEffect(root, ["task", "context", "BY-1"])).stdout).toContain(
          "title: Original title\n  description: Description for Original title",
        );
      }),
  );

  it.effect(
    "retains a Task Context draft when applying to an approved Task with immutable guidance",
    () =>
      Effect.gen(function* () {
        const root = yield* initializedRepo();

        yield* createTask(root, firstNow, "Original title");
        const draftResult = yield* runByInProcessEffect(root, [
          "--json",
          "task",
          "context",
          "draft",
          "BY-1",
        ]);
        const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
        writeFileSync(draft.draft.path, "# Updated title\n\nUpdated description");
        yield* setTaskState(root, "BY-1", "todo", secondNow);

        const result = yield* runByInProcessEffect(
          root,
          ["task", "context", "apply", "BY-1"],
          thirdNow,
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("code: invalid_task_state");
        expect(result.stdout).toContain("approved Task intent is immutable");
        expect(result.stdout).toContain(
          "Approved Task Context cannot be changed after Task Approval.",
        );
        expect(existsSync(draft.draft.path)).toBe(true);
        expect((yield* runByInProcessEffect(root, ["task", "context", "BY-1"])).stdout).toContain(
          "title: Original title\n  description: Description for Original title",
        );
      }),
  );

  it.effect("serializes missing Task IDs before command lookup", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(createTestWorkspace(), ["task", "show"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_usage");
      expect(result.stdout).toContain("help[1]");
    }),
  );

  it.effect.each(["show", "context", "approve"])(
    "rejects non-local Task IDs before state access in %s",
    (command) =>
      Effect.gen(function* () {
        const taskUseCases = fakeTaskUseCases({
          resolveTaskId: (taskId) => ({
            ok: false,
            code: "remote_tasks_not_supported",
            taskId,
            help: "Use a repo-local Task ID such as BY-1.",
          }),
        });
        const result = yield* runByInProcessEffect(
          createTestWorkspace(),
          ["task", command, "ZZ-1"],
          firstNow,
          {
            taskUseCases,
          },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("code: remote_tasks_not_supported");
        expect(result.stdout).toContain("taskId: ZZ-1");
      }),
  );

  it.effect.each(["show", "context", "approve"])(
    "prints task_not_found for unknown Task IDs in %s",
    (command) =>
      Effect.gen(function* () {
        const taskUseCases = fakeTaskUseCases({
          getTaskById: () => undefined,
          getTaskContextById: () => undefined,
          approveTask: () => ({ ok: false, code: "task_not_found" }),
        });
        const result = yield* runByInProcessEffect(
          createTestWorkspace(),
          ["task", command, "BY-999"],
          firstNow,
          {
            taskUseCases,
          },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(`error:
  code: task_not_found
  message: "Task was not found: BY-999"
  taskId: BY-999
help[1]: Run \`by task list --all --limit all\` to see known Tasks.
`);
      }),
  );

  it.effect("prints explicit empty list output with create help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "list"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            listTasks: () => ({ tasks: [], total: 0 }),
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`count: 0
total: 0
tasks: []
help[1]: "Run \`by task create --title \\"...\\" --file <path|->\` to create a task."
`);
    }),
  );

  it.effect(
    "prints bare dashboard rows for the actionable Tasks supplied by the Task use case",
    () =>
      Effect.gen(function* () {
        // The fixture supplies a preordered list; this test observes rendering and delegation only.
        const actionable: readonly TaskSummary[] = [
          taskSummary({
            id: "BY-2",
            title: "Todo newer",
            state: "todo",
            createdAt: secondNow,
            updatedAt: secondNow,
            startable: true,
          }),
          taskSummary({
            id: "BY-4",
            title: "Todo new",
            state: "todo",
            updatedAt: thirdNow,
            startable: true,
          }),
          taskSummary({
            title: "Todo old",
            state: "todo",
            startable: true,
          }),
        ];
        const result = yield* runByInProcessEffect(createTestWorkspace(), [], firstNow, {
          taskUseCases: fakeTaskUseCases({ listActionableTasks: () => actionable }),
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
count: 3
tasks[3]{id,title,state,createdAt,updatedAt}:
  BY-2,Todo newer,todo,"${secondNow}","${secondNow}"
  BY-4,Todo new,todo,"${firstNow}","${thirdNow}"
  BY-1,Todo old,todo,"${firstNow}","${firstNow}"
`);
      }),
  );

  it.effect("prints explicit empty dashboard output with create help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(createTestWorkspace(), [], firstNow, {
        taskUseCases: fakeTaskUseCases({ listActionableTasks: () => [] }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
count: 0
tasks: []
help[1]: "Run \`by task create --title \\"...\\" --file <path|->\` to create a task."
`);
    }),
  );

  it.effect("prints structured usage errors to stdout", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(createTestWorkspace(), [
        "task",
        "list",
        "--state",
        "not-a-state",
      ]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_usage
  message: "Expected one of the following cases: new, todo, done, cancelled"
help[1]: Run \`by --help\` for generated command help.
`);
    }),
  );

  it.effect("rejects Task titles containing line breaks", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      writeFileSync(join(root, "task.md"), "Description");

      const result = yield* runByInProcessEffect(root, [
        "task",
        "create",
        "--title",
        "Title\nwith line break",
        "--file",
        "task.md",
      ]);

      expect(result.status).toBe(2);
      expect(result.stdout).toContain("code: invalid_task_title");
    }),
  );

  it.effect.each([
    ["missing title", ["task", "create", "--file", "task.md"], "invalid_usage"],
    ["empty title", ["task", "create", "--title", "   ", "--file", "task.md"], "empty_title"],
    ["missing description input", ["task", "create", "--title", "Title"], "invalid_usage"],
  ] as const)("prints %s as a usage error", ([_name, args, code]) =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      writeFileSync(join(root, "task.md"), "Description");
      const result = yield* runByInProcessEffect(root, args);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`code: ${code}`);
      expect(result.stdout).toContain("help[1]");
    }),
  );

  it.effect("maps description input failures to actionable command output", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      mkdirSync(join(root, "directory"));
      writeFileSync(join(root, "invalid.bin"), Buffer.from([0xff]));
      writeFileSync(join(root, "large.md"), Buffer.alloc(256 * 1024 + 1, "x"));
      writeFileSync(join(root, "empty.md"), " \n\t");

      for (const [path, code] of [
        ["missing.md", "description_file_not_found"],
        ["directory", "description_file_unreadable"],
        ["invalid.bin", "invalid_description_encoding"],
        ["large.md", "description_too_large"],
        ["empty.md", "empty_description"],
      ] as const) {
        const result = yield* runByInProcessEffect(
          root,
          ["task", "create", "--title", "Title", "--file", path],
          firstNow,
          { taskUseCases: fakeTaskUseCases() },
        );

        expect(result.status, path).toBe(2);
        expect(result.stderr, path).toBe("");
        expect(result.stdout, path).toContain(`code: ${code}`);
        expect(result.stdout, path).toContain("help[1]");
      }
    }),
  );

  it.effect("prints not_initialized before task access to missing setup", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* runByInProcessEffect(root, ["task", "list"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: not_initialized
  message: This workspace is not initialized for But Why?.
help[1]: Run \`by init --task-prefix BY\` in the repository root.
`);
    }),
  );

  it.effect("prints invalid_repo_config for malformed repo config", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      mkdirSync(join(root, ".but-why"));
      writeFileSync(join(root, ".but-why/config.json"), "{");
      const result = yield* runByInProcessEffect(root, ["task", "list"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_repo_config");
      expect(result.stdout).toContain("help[1]");
    }),
  );

  it.effect("prints state_store_unavailable when repo state cannot be opened", () =>
    Effect.gen(function* () {
      const root = configuredRepo();

      mkdirSync(join(root, ".git", "but-why"), { recursive: true });
      writeFileSync(sharedStatePath(root), "not sqlite");
      const result = yield* runByInProcessEffect(root, ["task", "list"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: state_store_unavailable
  message: Shared But Why? state is unavailable.
help[1]: "Restore <git-common-dir>/but-why/state.sqlite, then run \`by init --task-prefix BY\`."
`);
    }),
  );
});

const taskSummary = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  id: "BY-1",
  title: "First",
  state: "new",
  createdAt: firstNow,
  updatedAt: firstNow,
  startable: false,
  blockedBy: [],
  ...overrides,
});

const taskRecord = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  ...taskSummary(),
  description: "Description",
  cancelReason: null,
  prerequisites: [],
  dependents: [],
  ...overrides,
});

const compactJsonTasks: readonly TaskSummary[] = [
  taskSummary(),
  taskSummary({
    id: "BY-2",
    title: "Second",
    state: "todo",
    createdAt: secondNow,
    updatedAt: thirdNow,
  }),
];

const initializedRepo = () =>
  Effect.gen(function* () {
    const root = createGitRepo();
    const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

    if (result.status !== 0) {
      throw new Error(result.stdout || result.stderr);
    }

    return root;
  });

const configuredRepo = (): string => {
  const root = createGitRepo();

  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why", "config.json"), '{"taskPrefix":"BY"}\n');

  return root;
};

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const createTask = (root: string, now: string, title: string) => {
  const descriptionPath = join(root, ".task-description.md");
  writeFileSync(descriptionPath, `Description for ${title}`);

  return Effect.flatMap(
    runByInProcessEffect(
      root,
      ["task", "create", "--title", title, "--file", descriptionPath],
      now,
    ),
    (result) =>
      result.status === 0 ? Effect.void : Effect.die(new Error(result.stdout || result.stderr)),
  );
};

const setTaskState = (root: string, id: string, state: TaskState, updatedAt: string) =>
  Effect.scoped(
    RepositorySql.pipe(
      Effect.flatMap((repository) =>
        repository.operation(
          "set Task fixture state",
          (sql) => sql`
          UPDATE tasks
          SET state = ${state}, updated_at = ${updatedAt}
          WHERE id = ${id}
        `,
        ),
      ),
      Effect.provide(
        repositorySqlLayer({
          statePath: sharedStatePath(root),
          commonDirectory: join(root, ".git"),
        }),
      ),
    ),
  );
