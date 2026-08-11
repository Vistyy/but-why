import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runApproveCommand } from "../../src/cli/task/commands/approve.js";
import { runContextCommand } from "../../src/cli/task/commands/context.js";
import { runContextApplyCommand } from "../../src/cli/task/commands/contextApply.js";
import { runContextDraftCommand } from "../../src/cli/task/commands/contextDraft.js";
import { runListCommand } from "../../src/cli/task/commands/list.js";
import { runTaskShowCommand } from "../../src/cli/task/commands/show.js";
import { dashboard } from "../../src/cli/task/dashboard.js";
import type { TaskCommandEnvironment } from "../../src/cli/task/taskCliSupport.js";
import type { TaskState } from "../../src/task/lifecycle.js";
import type { TaskReviewRecord } from "../../src/task/review/taskReview.js";
import type { TaskReviewInspectionUseCases } from "../../src/task/review/taskReviewUseCases.js";
import type { TaskRecord, TaskSummary } from "../../src/task/task.js";
import type { ApplyTaskContextDraftResult, TaskUseCases } from "../../src/task/taskUseCases.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import { fakeTaskUseCases } from "../support/taskUseCases.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

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

const taskReviewRecord = (overrides: Partial<TaskReviewRecord> = {}): TaskReviewRecord => ({
  id: "review-1",
  taskId: "BY-1",
  proposal: { title: "Inspect task", description: "Description", dependencyIds: [] },
  dependencyEvidence: [],
  policy: {
    id: "task_advisory_review",
    version: 1,
    agentProfile: "review",
    profileScope: "global",
    instructions: "Review the exact proposal.",
  },
  baseRef: "refs/heads/main",
  baseCommit: "a".repeat(40),
  workspacePath: "/tmp/review-1",
  state: "complete",
  outcome: "passed",
  workspaceCleanup: "removed",
  toolingFailure: null,
  abandonReason: null,
  findings: [],
  createdAt: firstNow,
  updatedAt: firstNow,
  ...overrides,
});

const taskReviewInspection = (
  latest: TaskReviewRecord | undefined = undefined,
): TaskReviewInspectionUseCases => ({
  getById: () => Effect.succeed(undefined),
  getLatestForTask: () => Effect.succeed(latest),
  proposalIsCurrent: () => Effect.succeed(false),
  inspectIdentity: () => Effect.succeed({ verified: true, workspace: { state: "absent" } }),
});

const environment = (
  taskUseCases: TaskUseCases,
  now = firstNow,
  taskReviewInspectionUseCases: TaskReviewInspectionUseCases = taskReviewInspection(),
): TaskCommandEnvironment => ({
  cwd: createTestWorkspace(),
  now: () => new Date(now),
  stdin: { fd: -1, isTerminal: true },
  taskUseCases,
  taskReviewInspectionUseCases,
});

describe("Task command Adapters", () => {
  it.effect("parses representative Task Create options and renders the mutation result", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      writeFileSync(join(root, "task.md"), "Description");
      let createInput: unknown;
      const result = yield* runByInProcessEffect(
        root,
        ["task", "create", "--title", "  Add login  ", "--file", "task.md", "--depends-on", "BY-2"],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            createTask: (input) => {
              createInput = input;
              return taskSummary({ id: "BY-3", title: input.title });
            },
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(createInput).toMatchObject({
        title: "Add login",
        now: firstNow,
        dependsOn: ["BY-2"],
      });
      expect(JSON.parse(result.stdout)).toMatchObject({
        task: { id: "BY-3", title: "Add login", state: "new", change: null },
        context: { id: "BY-3", title: "Add login" },
        help: ["Run `by task list` to see open tasks."],
      });
    }),
  );

  it.effect("maps Task Approval mutation and rejection results", () =>
    Effect.gen(function* () {
      const approvedTask = taskRecord({ state: "todo", updatedAt: secondNow });
      let approvalCalls = 0;
      const commandEnvironment = environment(
        fakeTaskUseCases({
          approveTask: () => {
            approvalCalls += 1;
            return approvalCalls === 1
              ? { ok: true as const, changed: true, task: approvedTask }
              : approvalCalls === 2
                ? { ok: true as const, changed: false, task: approvedTask }
                : {
                    ok: false as const,
                    code: "invalid_task_state" as const,
                    state: "done" as const,
                  };
          },
        }),
        secondNow,
      );

      const changed = yield* runApproveCommand({ taskId: "BY-1" }, commandEnvironment);
      const unchanged = yield* runApproveCommand({ taskId: "BY-1" }, commandEnvironment);
      const rejected = yield* runApproveCommand({ taskId: "BY-1" }, commandEnvironment);

      expect(changed).toEqual({
        exitCode: 0,
        stdout: { task: { id: "BY-1", state: "todo", changed: true, updatedAt: secondNow } },
      });
      expect(unchanged).toEqual({
        exitCode: 0,
        stdout: { task: { id: "BY-1", state: "todo", changed: false, updatedAt: secondNow } },
      });
      expect(rejected).toMatchObject({
        exitCode: 1,
        stdout: { error: { code: "invalid_task_state", taskId: "BY-1", state: "done" } },
      });
    }),
  );

  it.effect("maps Task List selectors and bounded result navigation", () =>
    Effect.gen(function* () {
      const inputs: Array<{
        readonly includeDone: boolean;
        readonly state?: TaskState;
        readonly limit?: number | "all";
      }> = [];
      const matching = [
        taskSummary({ id: "BY-1", state: "done" }),
        taskSummary({ id: "BY-2", title: "Second", state: "done" }),
        taskSummary({ id: "BY-3", title: "Third", state: "done" }),
      ];
      const commandEnvironment = environment(
        fakeTaskUseCases({
          listTasks: (input) => {
            inputs.push(input);
            const limit =
              input.limit === "all" ? matching.length : (input.limit ?? matching.length);
            return { tasks: matching.slice(0, limit), total: matching.length };
          },
        }),
      );

      yield* runListCommand({ all: false, state: undefined, limit: "5" }, commandEnvironment);
      yield* runListCommand({ all: true, state: undefined, limit: "all" }, commandEnvironment);
      const filtered = yield* runListCommand(
        { all: false, state: "done", limit: "2" },
        commandEnvironment,
      );

      expect(inputs).toEqual([
        { includeDone: false, limit: 5 },
        { includeDone: true, limit: "all" },
        { includeDone: true, state: "done", limit: 2 },
      ]);
      expect(filtered.stdout).toMatchObject({
        count: 2,
        total: 3,
        tasks: [
          { id: "BY-1", change: null },
          { id: "BY-2", change: null },
        ],
        help: ["Run `by task list --state done --limit all` to retrieve all matching Tasks."],
      });
    }),
  );

  it.effect("rejects an invalid Task List limit before calling the Task use case", () =>
    Effect.gen(function* () {
      const result = yield* runListCommand(
        { all: false, state: undefined, limit: "0" },
        environment(
          fakeTaskUseCases({
            listTasks: () => {
              throw new Error("Task List state must not be read");
            },
          }),
        ),
      );

      expect(result).toMatchObject({
        exitCode: 2,
        stdout: { error: { code: "invalid_task_list_limit", limit: "0" } },
      });
    }),
  );

  it.effect("renders Task Show navigation, its retained Review, and Task Context", () =>
    Effect.gen(function* () {
      const retainedReview = taskReviewRecord({
        id: "review-retained",
        state: "complete",
        outcome: "blocked",
        workspaceCleanup: "removed",
        findings: [
          {
            title: "Ambiguous outcome",
            description: "Clarify the expected result.",
            evidence: "The proposal permits two outcomes.",
            files: ["docs/spec.md"],
            artifactRefs: [],
          },
        ],
        updatedAt: secondNow,
      });
      const commandEnvironment = environment(
        fakeTaskUseCases({
          getTaskForInspection: () =>
            taskRecord({ title: "Inspect task", state: "todo", updatedAt: secondNow }),
          getTaskContextById: () => ({
            id: "BY-1",
            title: "Inspect task",
            description: "Full intent\n\nWith details.",
          }),
        }),
        firstNow,
        taskReviewInspection(retainedReview),
      );

      const shown = yield* runTaskShowCommand({ taskId: "BY-1" }, commandEnvironment);
      const context = yield* runContextCommand({ taskId: "BY-1" }, commandEnvironment);

      expect(shown.stdout).toEqual({
        task: {
          id: "BY-1",
          title: "Inspect task",
          state: "todo",
          createdAt: firstNow,
          updatedAt: secondNow,
          prerequisites: [],
          dependents: [],
          change: null,
          review: {
            id: "review-retained",
            state: "complete",
            outcome: "blocked",
            proposalCurrent: false,
            findingCount: 1,
            findings: [
              {
                title: "Ambiguous outcome",
                description: "Clarify the expected result.",
                evidence: "The proposal permits two outcomes.",
                files: ["docs/spec.md"],
                artifactRefs: [],
              },
            ],
            workspaceCleanup: "removed",
            toolingFailure: null,
          },
        },
        contextCommand: "by task context BY-1",
        reviewCommand: "by task review show review-retained",
      });
      expect(context.stdout).toEqual({
        task: {
          id: "BY-1",
          title: "Inspect task",
          description: "Full intent\n\nWith details.",
        },
      });
    }),
  );

  it.effect("renders Task Context draft and application results", () =>
    Effect.gen(function* () {
      const persistedTask = taskRecord({
        description: "Updated description",
        updatedAt: secondNow,
      });
      const commandEnvironment = environment(
        fakeTaskUseCases({
          createTaskContextDraft: () => ({
            path: "/tmp/task-context-draft.md",
            content: "Original description",
          }),
          applyTaskContextDraft: () => ({
            ok: true,
            task: persistedTask,
            context: {
              id: "BY-1",
              title: persistedTask.title,
              description: persistedTask.description,
            },
          }),
        }),
        secondNow,
      );

      const draft = yield* runContextDraftCommand({ taskId: "BY-1" }, commandEnvironment);
      const applied = yield* runContextApplyCommand({ taskId: "BY-1" }, commandEnvironment);

      expect(draft.stdout).toEqual({
        draft: { path: "/tmp/task-context-draft.md", content: "Original description" },
      });
      expect(applied.stdout).toMatchObject({
        task: { id: "BY-1", state: "new", updatedAt: secondNow },
        context: { id: "BY-1", title: "First", description: "Updated description" },
      });
    }),
  );

  it.effect("translates Task Context application failures", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly result: ApplyTaskContextDraftResult;
        readonly code: string;
        readonly command?: string;
      }> = [
        {
          result: {
            ok: false,
            error: { code: "task_context_draft_not_found", path: "/tmp/draft.md" },
          },
          code: "task_context_draft_not_found",
          command: "Run `by task context draft <task-id>` to create a Task Context draft.",
        },
        {
          result: {
            ok: false,
            error: { code: "invalid_task_context_draft", path: "/tmp/draft.md" },
          },
          code: "invalid_task_context_draft",
          command: "Fix the draft, then rerun `by task context apply <task-id>`.",
        },
        {
          result: { ok: false, code: "invalid_task_state", state: "todo" },
          code: "invalid_task_state",
        },
        {
          result: {
            ok: false,
            code: "task_context_draft_cleanup_failed",
            task: taskRecord({ description: "Persisted description" }),
            path: "/tmp/draft.md",
          },
          code: "task_context_draft_cleanup_failed",
        },
      ];

      for (const testCase of cases) {
        const result = yield* runContextApplyCommand(
          { taskId: "BY-1" },
          environment(
            fakeTaskUseCases({ applyTaskContextDraft: () => testCase.result }),
            secondNow,
          ),
        );

        expect(result).toMatchObject({
          exitCode: 1,
          stdout: { error: { code: testCase.code } },
        });
        if (testCase.command !== undefined) {
          expect(result.stdout).toMatchObject({ help: [testCase.command] });
        }
        if (testCase.code === "task_context_draft_cleanup_failed") {
          expect(result.stdout).toMatchObject({
            error: {
              task: taskRecord({ description: "Persisted description" }),
              path: "/tmp/draft.md",
            },
          });
        }
      }
    }),
  );

  it.effect("renders empty Task List and dashboard decisions", () =>
    Effect.gen(function* () {
      const commandEnvironment = environment(
        fakeTaskUseCases({
          listTasks: () => ({ tasks: [], total: 0 }),
          listActionableTasks: () => [],
        }),
      );
      const list = yield* runListCommand(
        { all: false, state: undefined, limit: "5" },
        commandEnvironment,
      );
      const home = yield* dashboard("~/.local/bin/by", "But Why", commandEnvironment);

      expect(list.stdout).toEqual({
        count: 0,
        total: 0,
        tasks: [],
        help: ['Run `by task create --title "..." --file <path|->` to create a task.'],
      });
      expect(home.stdout).toEqual({
        bin: "~/.local/bin/by",
        description: "But Why",
        count: 0,
        tasks: [],
        help: ['Run `by task create --title "..." --file <path|->` to create a task.'],
      });
    }),
  );

  it.effect("renders the actionable Tasks selected for the dashboard", () =>
    Effect.gen(function* () {
      const result = yield* dashboard(
        "~/.local/bin/by",
        "But Why",
        environment(
          fakeTaskUseCases({
            listActionableTasks: () => [
              taskSummary({
                id: "BY-2",
                title: "Start this task",
                state: "todo",
                updatedAt: secondNow,
                startable: true,
              }),
            ],
          }),
        ),
      );

      expect(result.stdout).toEqual({
        bin: "~/.local/bin/by",
        description: "But Why",
        count: 1,
        tasks: [
          {
            id: "BY-2",
            title: "Start this task",
            state: "todo",
            createdAt: firstNow,
            updatedAt: secondNow,
          },
        ],
      });
    }),
  );
});
