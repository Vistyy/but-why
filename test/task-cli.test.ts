import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, it as ordinaryIt } from "vitest";

import { collapseHome } from "../src/cli.js";
import { prepareStateDatabaseSession } from "../src/init/stateDatabase.js";
import { openSqliteTaskStore } from "../src/sqlite/sqliteTaskStore.js";
import { loadTaskUseCases } from "../src/localTask/taskUseCases.js";
import type { TaskState } from "../src/task/lifecycle.js";
import type { TaskRecord, TaskSummary } from "../src/task/task.js";
import { publicTaskId } from "../src/task/taskId.js";
import type { TaskStore } from "../src/task/taskStore.js";
import {
  byExecutable,
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runByInProcessEffect,
} from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { fakeTaskUseCases } from "./support/taskUseCases.js";
import { taskStateTransitionPath } from "./support/taskLifecycle.js";
import { createTaskStore as createIsolatedTaskStore } from "./support/taskStore.js";

const expectedBin = collapseHome(byExecutable);
const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";
const thirdNow = "2026-06-30T12:10:00.000Z";
// Four workers exercise overlapping SQLite writers while keeping subprocess tests fast.
const concurrentWriterCount = 4;

describe("by task CLI", () => {
  it.effect(
    "creates a new Task with trimmed title, exact description, configured prefix, and summary output",
    () =>
      Effect.gen(function* () {
        const root = initializedRepo();
        writeFileSync(join(root, "task.md"), "  Preserve me exactly.\n\n");

        const result = yield* runByInProcessEffect(
          root,
          ["task", "create", "--title", "  Add   login  ", "--description-file", "task.md"],
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
help[1]: Run \`by task list\` to see open tasks.`);

        expect(taskStore(root).getTaskById(publicTaskId("BY-1"))).toMatchObject({
          id: "BY-1",
          title: "Add   login",
          description: "  Preserve me exactly.\n\n",
          state: "new",
          createdAt: firstNow,
          updatedAt: firstNow,
        });
      }),
  );

  it.effect(
    "approves Task intent durably and reports repeated approval as an unchanged success",
    () =>
      Effect.gen(function* () {
        const root = initializedRepo();

        createTask(root, firstNow, "Approve intent");

        const firstApproval = yield* runByInProcessEffect(
          root,
          ["task", "approve", "BY-1"],
          secondNow,
        );
        const repeatedApproval = yield* runByInProcessEffect(
          root,
          ["task", "approve", "BY-1"],
          thirdNow,
        );

        expect(firstApproval.status).toBe(0);
        expect(firstApproval.stderr).toBe("");
        expect(firstApproval.stdout).toBe(`task:
  id: BY-1
  state: todo
  changed: true
  updatedAt: "${secondNow}"`);
        expect(repeatedApproval.status).toBe(0);
        expect(repeatedApproval.stderr).toBe("");
        expect(repeatedApproval.stdout).toBe(`task:
  id: BY-1
  state: todo
  changed: false
  updatedAt: "${secondNow}"`);
        expect(taskStore(root).getTaskById(publicTaskId("BY-1"))).toMatchObject({
          state: "todo",
          updatedAt: secondNow,
        });
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
            approveTask: () => ({ ok: false, code: "invalid_task_state", state: "implementing" }),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_task_state");
      expect(result.stdout).toContain("Cannot approve task BY-1 from state implementing");
      expect(result.stdout).toContain("by change submit <change-id>");
    }),
  );

  it.effect("does not consume a Task ID when validation fails before insert", () =>
    Effect.gen(function* () {
      const root = initializedRepo();
      writeFileSync(join(root, "task.md"), "Description");

      expect(
        (yield* runByInProcessEffect(root, [
          "task",
          "create",
          "--title",
          "   ",
          "--description-file",
          "task.md",
        ])).status,
      ).toBe(2);

      const result = yield* runByInProcessEffect(
        root,
        ["task", "create", "--title", "First valid", "--description-file", "task.md"],
        firstNow,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("id: BY-1");
    }),
  );

  it.effect("lists non-done Tasks by default in creation order with count", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const taskUseCases = fakeTaskUseCases({
        listTasks: () => [
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
            state: "ready",
            createdAt: secondNow,
            updatedAt: thirdNow,
            startable: false,
            blockedBy: [],
          },
        ],
      });

      const result = yield* runByInProcessEffect(root, ["task", "list"], firstNow, {
        taskUseCases,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`count: 2
tasks[2]:
  - id: BY-1
    title: First
    state: new
    createdAt: "${firstNow}"
    updatedAt: "${firstNow}"
    startable: false
    blockedBy: []
    change: null
  - id: BY-2
    title: Second
    state: ready
    createdAt: "${secondNow}"
    updatedAt: "${thirdNow}"
    startable: false
    blockedBy: []
    change: null`);
    }),
  );

  it.effect("lists Tasks as compact JSON when selected after the command", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "list", "--output", "json"],
        firstNow,
        { taskUseCases: fakeTaskUseCases({ listTasks: () => listedTasks }) },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.endsWith("\n")).toBe(true);
      expect(result.stdout.trimEnd()).not.toContain("\n");
      expect(JSON.parse(result.stdout)).toEqual({
        count: 2,
        tasks: listedTasks.map((task) => ({ ...task, change: null })),
      });
    }),
  );

  ordinaryIt("uses numeric ID order when Tasks share the same creation timestamp", () => {
    const tasks = createIsolatedTaskStore();

    tasks.createTask({ title: "First", description: "First", now: firstNow });
    tasks.createTask({ title: "Second", description: "Second", now: firstNow });

    expect(tasks.listTasks({ includeDone: false }).map((task) => task.id)).toEqual([
      "BY-1",
      "BY-2",
    ]);
  });

  it.effect("shows new Tasks on the dashboard so they can be approved", () =>
    Effect.gen(function* () {
      const task = taskSummary({ title: "Needs approval" });
      const result = yield* runByInProcessEffect(createTestWorkspace(), [], firstNow, {
        taskUseCases: fakeTaskUseCases({ listActionableTasks: () => [task] }),
      });

      expect(result.stdout).toContain(`BY-1,Needs approval,new,"${firstNow}","${firstNow}"`);
    }),
  );

  it.effect("removes started Tasks from the default dashboard", () =>
    Effect.gen(function* () {
      const root = initializedRepoWithDefault();

      createTask(root, firstNow, "Started");
      expect(
        (yield* runByInProcessEffect(root, ["task", "approve", "BY-1"], firstNow)).status,
      ).toBe(0);
      expect(
        taskStore(root).transitionTaskState({
          taskId: publicTaskId("BY-1"),
          to: "implementing",
          now: secondNow,
        }).ok,
      ).toBe(true);

      expect((yield* runByInProcessEffect(root, [])).stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
count: 0
tasks: []
help[1]: "Run \`by task create --title \\"...\\" --description-file <file>\` to create a task."`);
    }),
  );

  ordinaryIt("rejects invalid Task state transitions through the Task module", () => {
    const tasks = createIsolatedTaskStore();
    tasks.createTask({ title: "Invalid transition", description: "Description", now: firstNow });

    expect(
      tasks.transitionTaskState({
        taskId: publicTaskId("BY-1"),
        to: "ready",
        now: secondNow,
      }),
    ).toEqual({
      ok: false,
      code: "invalid_task_state_transition",
      from: "new",
      to: "ready",
    });
    expect(tasks.getTaskById(publicTaskId("BY-1"))).toMatchObject({
      state: "new",
      createdAt: firstNow,
      updatedAt: firstNow,
    });
  });

  it.effect("supports --all and --state, with --state implying done visibility", () =>
    Effect.gen(function* () {
      const tasks = createIsolatedTaskStore();
      tasks.createTask({ title: "New", description: "Description", now: firstNow });
      tasks.createTask({ title: "Todo", description: "Description", now: firstNow });
      tasks.createTask({ title: "Done", description: "Description", now: firstNow });
      expect(tasks.approveTask({ taskId: publicTaskId("BY-2"), now: secondNow }).ok).toBe(true);
      transitionStoreTask(tasks, "BY-3", "done", thirdNow);

      expect(tasks.listTasks({ includeDone: false }).map((task) => task.id)).toEqual([
        "BY-1",
        "BY-2",
      ]);
      expect(tasks.listTasks({ includeDone: true }).map((task) => task.id)).toEqual([
        "BY-1",
        "BY-2",
        "BY-3",
      ]);
      expect(tasks.listTasks({ includeDone: true, state: "done" }).map((task) => task.id)).toEqual([
        "BY-3",
      ]);

      const root = createTestWorkspace();
      const inputs: Array<{ readonly includeDone: boolean; readonly state?: TaskState }> = [];
      const taskUseCases = fakeTaskUseCases({
        listTasks: (input) => {
          inputs.push(input);
          return listedTasks;
        },
      });

      yield* runByInProcessEffect(root, ["task", "list", "--output", "json"], firstNow, {
        taskUseCases,
      });
      yield* runByInProcessEffect(root, ["task", "list", "--all", "--output", "json"], firstNow, {
        taskUseCases,
      });
      yield* runByInProcessEffect(
        root,
        ["task", "list", "--state", "done", "--output", "json"],
        firstNow,
        {
          taskUseCases,
        },
      );

      expect(inputs).toEqual([
        { includeDone: false },
        { includeDone: true },
        { includeDone: true, state: "done" },
      ]);
    }),
  );

  it.effect("shows compact Task metadata without Task Context", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "show", "BY-1"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            getTaskById: () =>
              taskRecord({ title: "Inspect task", state: "ready", updatedAt: secondNow }),
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`task:
  id: BY-1
  title: Inspect task
  description: Description
  state: ready
  createdAt: "${firstNow}"
  updatedAt: "${secondNow}"
  commentCount: 0
  prerequisites: []
  dependents: []
  change: null`);
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
              comments: [],
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
  comments: []`);
    }),
  );

  it.effect("creates a managed Task Context draft with the current title and description", () =>
    Effect.gen(function* () {
      const root = initializedRepo();

      createTask(root, firstNow, "Draft title");

      const result = yield* runByInProcessEffect(root, [
        "task",
        "context",
        "draft",
        "BY-1",
        "--output",
        "json",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");

      const output = JSON.parse(result.stdout) as { draft: { path: string } };

      expect(output.draft.path).toMatch(
        /\.git\/but-why\/task-context-drafts\/by-1-[a-f0-9]{12}\.md$/,
      );
      expect(existsSync(output.draft.path)).toBe(true);
      expect(readFileSync(output.draft.path, "utf8")).toBe(
        "# Draft title\n\nDescription for Draft title",
      );
    }),
  );

  it.effect("replaces a prior Task Context draft with current Task Context", () =>
    Effect.gen(function* () {
      const root = initializedRepo();

      createTask(root, firstNow, "Original title");
      const firstDraft = JSON.parse(
        (yield* runByInProcessEffect(root, [
          "task",
          "context",
          "draft",
          "BY-1",
          "--output",
          "json",
        ])).stdout,
      ) as { draft: { path: string } };
      writeFileSync(firstDraft.draft.path, "# Current title\n\nCurrent description");
      expect(
        (yield* runByInProcessEffect(root, ["task", "context", "apply", "BY-1"], secondNow)).status,
      ).toBe(0);

      const draftResult = yield* runByInProcessEffect(root, [
        "task",
        "context",
        "draft",
        "BY-1",
        "--output",
        "json",
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
      const root = initializedRepo();

      createTask(root, firstNow, "Original title");

      const draftResult = yield* runByInProcessEffect(root, [
        "task",
        "context",
        "draft",
        "BY-1",
        "--output",
        "json",
      ]);
      const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
      writeFileSync(draft.draft.path, "#  Updated title  \n\nUpdated description\n\n");

      const result = yield* runByInProcessEffect(
        root,
        ["task", "context", "apply", "BY-1", "--output", "json"],
        secondNow,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        task: {
          id: "BY-1",
          title: "Updated title",
          description: "Updated description\n\n",
          state: "new",
          updatedAt: secondNow,
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
      const root = initializedRepo();

      createTask(root, firstNow, "Original title");

      const draftResult = yield* runByInProcessEffect(root, [
        "task",
        "context",
        "draft",
        "BY-1",
        "--output",
        "json",
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
      const root = initializedRepo();

      createTask(root, firstNow, "Original title");
      const draftResult = yield* runByInProcessEffect(root, [
        "task",
        "context",
        "draft",
        "BY-1",
        "--output",
        "json",
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

  it.effect.each(["implementing", "done"] as const)(
    "retains Task Context drafts when applying to a %s Task",
    (state) =>
      Effect.gen(function* () {
        const root = initializedRepo();

        createTask(root, firstNow, "Original title");
        const draftResult = yield* runByInProcessEffect(root, [
          "task",
          "context",
          "draft",
          "BY-1",
          "--output",
          "json",
        ]);
        const draft = JSON.parse(draftResult.stdout) as { draft: { path: string } };
        writeFileSync(draft.draft.path, "# Updated title\n\nUpdated description");
        transitionTaskState(root, "BY-1", state, secondNow);

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
    "appends Task comments as ordered raw Task Context before Start without changing state",
    () =>
      Effect.gen(function* () {
        const root = initializedRepo();

        createTask(root, firstNow, "Commented task");
        writeFileSync(join(root, "comment-1.md"), "First comment\n\nWith Markdown.\n");
        writeFileSync(join(root, "comment-2.md"), "First comment\n\nWith Markdown.\n");

        const firstResult = yield* runByInProcessEffect(
          root,
          ["task", "comment", "BY-1", "--file", "comment-1.md"],
          thirdNow,
        );
        expect(
          (yield* runByInProcessEffect(root, ["task", "approve", "BY-1"], thirdNow)).status,
        ).toBe(0);
        const duplicateResult = yield* runByInProcessEffect(
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

        expect((yield* runByInProcessEffect(root, ["task", "show", "BY-1"])).stdout).toBe(`task:
  id: BY-1
  title: Commented task
  description: Description for Commented task
  state: todo
  createdAt: "${firstNow}"
  updatedAt: "2026-06-30T12:15:00.000Z"
  commentCount: 2
  prerequisites: []
  dependents: []
  change: null`);
        expect((yield* runByInProcessEffect(root, ["task", "context", "BY-1"])).stdout).toBe(`task:
  id: BY-1
  title: Commented task
  description: Description for Commented task
  comments[2]: "First comment\\n\\nWith Markdown.\\n","First comment\\n\\nWith Markdown.\\n"`);
      }),
  );

  it.effect("maps rejected Task comments to command output", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      writeFileSync(join(root, "comment.md"), "Too late");

      const result = yield* runByInProcessEffect(
        root,
        ["task", "comment", "BY-1", "--file", "comment.md"],
        thirdNow,
        {
          taskUseCases: fakeTaskUseCases({
            getTaskById: () => taskRecord({ state: "implementing" }),
            appendTaskComment: () => ({
              ok: false,
              code: "invalid_task_state",
              state: "implementing",
            }),
          }),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: invalid_task_state");
      expect(result.stdout).toContain(
        "Cannot append a Task comment to task BY-1 from state implementing",
      );
    }),
  );

  it.effect("preserves a leading UTF-8 BOM in Task comment content", () =>
    Effect.gen(function* () {
      const root = initializedRepo();

      createTask(root, firstNow, "BOM comment");
      writeFileSync(join(root, "bom.md"), Buffer.from([0xef, 0xbb, 0xbf, 0x42, 0x4f, 0x4d]));

      const result = yield* runByInProcessEffect(
        root,
        ["task", "comment", "BY-1", "--file", "bom.md"],
        secondNow,
      );

      expect(result.status).toBe(0);

      expect(taskStore(root).getTaskContextById(publicTaskId("BY-1"))?.comments).toEqual([
        "\uFEFFBOM",
      ]);
    }),
  );

  it.effect("reports actionable Task comment input errors without changing the Task", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      let appendCalls = 0;
      writeFileSync(join(root, "valid.md"), "Valid comment");
      mkdirSync(join(root, "comment-dir"));
      writeFileSync(join(root, "empty.md"), " \n\t");
      writeFileSync(join(root, "invalid.bin"), Buffer.from([0xff]));

      const taskUseCases = fakeTaskUseCases({
        resolveTaskId: (taskId) =>
          taskId === "by-1"
            ? {
                ok: false,
                code: "remote_tasks_not_supported",
                taskId,
                help: "Use a repo-local Task ID such as BY-1.",
              }
            : { ok: true, taskId },
        getTaskById: (taskId) => (taskId === "BY-1" ? taskRecord() : undefined),
        appendTaskComment: () => {
          appendCalls += 1;
          return { ok: true, taskId: publicTaskId("BY-1"), commentCount: 1 };
        },
      });
      const cases = [
        {
          name: "missing file flag",
          args: ["task", "comment", "BY-1"],
          status: 2,
          code: "missing_comment_file",
        },
        {
          name: "remote-backed task ID",
          args: ["task", "comment", "by-1", "--file", "valid.md"],
          status: 1,
          code: "remote_tasks_not_supported",
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
        const result = yield* runByInProcessEffect(root, testCase.args, thirdNow, { taskUseCases });

        expect(result.status, testCase.name).toBe(testCase.status);
        expect(result.stderr, testCase.name).toBe("");
        expect(result.stdout, testCase.name).toContain(`code: ${testCase.code}`);
        expect(result.stdout, testCase.name).toContain("help[1]");
      }

      expect(appendCalls).toBe(0);
    }),
  );

  ordinaryIt("persists Task comments across CLI processes", async () => {
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

    const contextResult = await runByAsync(root, {}, "task", "context", "BY-1");
    expect(contextResult.stdout).toBe(`task:
  id: BY-1
  title: Persistent comments
  description: Description for Persistent comments
  comments[1]: "Persist me exactly\\n"`);
  });

  ordinaryIt("preserves all concurrent Task comment appends", async () => {
    const root = initializedRepo();
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

    const comments = taskStore(root).getTaskContextById(publicTaskId("BY-1"))?.comments ?? [];

    expect(comments).toHaveLength(commentCount);
    expect(new Set(comments)).toEqual(
      new Set(Array.from({ length: commentCount }, (_value, index) => `Comment ${index}`)),
    );

    const showResult = await runByAsync(root, {}, "task", "show", "BY-1");
    expect(showResult.stdout).toContain(`commentCount: ${commentCount}`);
  });

  it.effect("serializes missing Task IDs before command lookup", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(createTestWorkspace(), ["task", "show"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("code: missing_task_id");
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
help[1]: Run \`by task list --all\` to see known Tasks.`);
      }),
  );

  it.effect("prints explicit empty list output with create help", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(
        createTestWorkspace(),
        ["task", "list"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({ listTasks: () => [] }),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`count: 0
tasks: []
help[1]: "Run \`by task create --title \\"...\\" --description-file <file>\` to create a task."`);
    }),
  );

  it.effect("prints bare dashboard with only actionable Tasks by priority and updated time", () =>
    Effect.gen(function* () {
      const tasks = createIsolatedTaskStore();
      tasks.createTask({ title: "Todo old", description: "Description", now: firstNow });
      expect(tasks.approveTask({ taskId: publicTaskId("BY-1"), now: firstNow }).ok).toBe(true);
      tasks.createTask({ title: "Ready", description: "Description", now: secondNow });
      transitionStoreTask(tasks, "BY-2", "ready", secondNow);
      tasks.createTask({ title: "Implementing", description: "Description", now: firstNow });
      transitionStoreTask(tasks, "BY-3", "implementing", thirdNow);
      tasks.createTask({ title: "Todo new", description: "Description", now: firstNow });
      expect(tasks.approveTask({ taskId: publicTaskId("BY-4"), now: firstNow }).ok).toBe(true);
      expect(
        tasks.appendTaskComment({
          taskId: publicTaskId("BY-4"),
          content: "Bump updated time",
          now: () => thirdNow,
        }).ok,
      ).toBe(true);

      const actionable = tasks.listActionableTasks();
      const result = yield* runByInProcessEffect(createTestWorkspace(), [], firstNow, {
        taskUseCases: fakeTaskUseCases({ listActionableTasks: () => actionable }),
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`bin: ${expectedBin}
description: Validate completed code changes against approved human intent.
count: 3
tasks[3]{id,title,state,createdAt,updatedAt}:
  BY-2,Ready,ready,"${secondNow}","${secondNow}"
  BY-4,Todo new,todo,"${firstNow}","${thirdNow}"
  BY-1,Todo old,todo,"${firstNow}","${firstNow}"`);
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
help[1]: "Run \`by task create --title \\"...\\" --description-file <file>\` to create a task."`);
    }),
  );

  it.effect("prints structured usage errors to stdout", () =>
    Effect.gen(function* () {
      const result = yield* runByInProcessEffect(createTestWorkspace(), [
        "task",
        "list",
        "--state",
        "blocked",
      ]);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_task_state
  message: Unknown task state blocked.
  state: blocked
help[1]: "Use one of: new, todo, implementing, validating, ready, done."`);
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
        "--description-file",
        "task.md",
      ]);

      expect(result.status).toBe(2);
      expect(result.stdout).toContain("code: invalid_task_title");
    }),
  );

  it.effect.each([
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

  it.effect("maps description file failures to actionable command output", () =>
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
          ["task", "create", "--title", "Title", "--description-file", path],
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
help[1]: Run \`by init --task-prefix BY\` in the repository root.`);
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

  ordinaryIt("serializes concurrent Task creation through repo state", async () => {
    const root = initializedRepo();
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

    expect(
      taskStore(root)
        .listTasks({ includeDone: true })
        .map((task) => task.id),
    ).toEqual(Array.from({ length: createCount }, (_value, index) => `BY-${index + 1}`));
  });

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
help[1]: "Restore <git-common-dir>/but-why/state.sqlite, then run \`by init --task-prefix BY\`."`);
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
  commentCount: 0,
  prerequisites: [],
  dependents: [],
  ...overrides,
});

const listedTasks: readonly TaskSummary[] = [
  taskSummary(),
  taskSummary({
    id: "BY-2",
    title: "Second",
    state: "ready",
    createdAt: secondNow,
    updatedAt: thirdNow,
  }),
];

const transitionStoreTask = (
  tasks: TaskStore,
  taskId: string,
  state: TaskState,
  now: string,
): void => {
  for (const nextState of taskStateTransitionPath(state)) {
    const result = tasks.transitionTaskState({ taskId: publicTaskId(taskId), to: nextState, now });
    if (!result.ok) throw new Error(result.code);
  }
};

const initializedRepo = (): string => createInitializedRepo();

const initializedRepoWithDefault = (): string => {
  const root = initializedRepo();

  commitButWhyConfigAndRecordDefault(root);

  return root;
};

const configuredRepo = (): string => {
  const root = createGitRepo();

  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why", "config.json"), '{"taskPrefix":"BY"}\n');

  return root;
};

const sharedStatePath = (root: string): string => join(root, ".git", "but-why", "state.sqlite");

const taskStore = (root: string) =>
  openSqliteTaskStore({
    ...prepareStateDatabaseSession({
      statePath: sharedStatePath(root),
    }),
    taskPrefix: "BY",
  });

const createTask = (root: string, now: string, title: string): void => {
  taskStore(root).createTask({
    title,
    description: `Description for ${title}`,
    now,
  });
};

const transitionTaskState = (
  root: string,
  id: string,
  state: TaskState,
  updatedAt: string,
): void => {
  const tasksLoad = loadTaskUseCases({
    cwd: root,
    requireState: true,
  });

  if (!tasksLoad.ok) {
    throw new Error(`Could not load Tasks: ${tasksLoad.error.code}`);
  }

  for (const nextState of taskStateTransitionPath(state)) {
    const result = tasksLoad.tasks.transitionTaskState({
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
