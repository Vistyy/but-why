import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runContextCommand } from "../../src/cli/task/commands/context.js";
import { runContextApplyCommand } from "../../src/cli/task/commands/contextApply.js";
import { runContextDraftCommand } from "../../src/cli/task/commands/contextDraft.js";
import { runListCommand } from "../../src/cli/task/commands/list.js";
import { runRenameCommand } from "../../src/cli/task/commands/rename.js";
import { runReviseCommand } from "../../src/cli/task/commands/revise.js";
import { runTaskShowCommand } from "../../src/cli/task/commands/show.js";
import { runTaskSubmitCommand } from "../../src/cli/task/commands/submit.js";
import { taskReviewView } from "../../src/cli/task/commands/taskReviewView.js";
import { dashboard } from "../../src/cli/task/dashboard.js";
import type { TaskCommandEnvironment } from "../../src/cli/task/taskCliSupport.js";
import type { TaskState } from "../../src/task/lifecycle.js";
import type { TaskReviewRecord } from "../../src/task/review/taskReview.js";
import type { TaskReviewInspectionUseCases } from "../../src/task/review/taskReviewUseCases.js";
import type { TaskRecord, TaskSummary } from "../../src/task/task.js";
import { publicTaskId } from "../../src/task/taskId.js";
import type { RenameTaskInput, RenameTaskResult } from "../../src/task/taskStore.js";
import type { ApplyTaskContextDraftResult, TaskUseCases } from "../../src/task/taskUseCases.js";
import type {
  CancellationUseCases,
  TaskCancellationResult,
} from "../../src/taskChange/cancelTaskChange.js";
import type { TaskChangeTaskUseCases } from "../../src/taskChange/composition/loadTaskChangeTaskUseCases.js";
import { runByInProcessEffect } from "../support/by-cli.js";
import { fakeTaskChangeTaskUseCases, fakeTaskUseCases } from "../support/taskUseCases.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const firstNow = "2026-06-30T12:00:00.000Z";
const secondNow = "2026-06-30T12:05:00.000Z";

const taskSummary = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  id: "BY-1",
  title: "First",
  state: "new",
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
  id: 1,
  taskId: "BY-1",
  proposal: { title: "Inspect task", description: "Description", dependencyIds: [] },
  dependencyEvidence: [],
  reviewerConfiguration: {
    profile: {
      agentProfile: "review",
      scope: "global",
      profile: { agentRuntime: "pi", runtimeConfig: { model: "test-model" } },
    },
    builtInInstructions: "Review the exact proposal.",
    guidance: null,
  },
  baseRef: "refs/heads/main",
  baseCommit: "a".repeat(40),
  workspacePath: "/tmp/review-1",
  state: "complete",
  outcome: "passed",
  workspaceCleanup: "removed",
  cleanupBlockingReason: null,
  toolingFailure: null,
  findings: [],
  ...overrides,
});

const taskReviewInspection = (
  latest: TaskReviewRecord | undefined = undefined,
): TaskReviewInspectionUseCases => ({
  getCompletedSimplificationAdvice: () => Effect.succeed(undefined),
  getById: () => Effect.succeed(undefined),
  getLatestForTask: () => Effect.succeed(latest),
  listForTask: () => Effect.succeed(latest === undefined ? [] : [latest]),
  proposalIsCurrent: () => Effect.succeed(false),
  inspectIdentity: () => Effect.succeed({ verified: true, workspace: { state: "absent" } }),
});

const environment = (
  taskUseCases: TaskUseCases,
  now = firstNow,
  taskReviewInspectionUseCases: TaskReviewInspectionUseCases = taskReviewInspection(),
  taskChangeTaskUseCases: TaskCommandEnvironment["taskChangeTaskUseCases"] = undefined,
): TaskCommandEnvironment => ({
  cwd: createTestWorkspace(),
  now: () => new Date(now),
  stdin: { fd: -1, isTerminal: true },
  taskUseCases,
  ...(taskChangeTaskUseCases === undefined ? {} : { taskChangeTaskUseCases }),
  taskReviewInspectionUseCases,
});

const renameEnvironment = (
  renameTask: (input: RenameTaskInput) => RenameTaskResult,
  now = firstNow,
): TaskCommandEnvironment => {
  const coordinated: TaskChangeTaskUseCases = {
    idPrefix: "BY",
    resolveTaskId: (taskId) => ({ ok: true, taskId }),
    editTaskDependencies: () => Effect.die("Unexpected Task dependency edit call"),
    renameTask: (input) => Effect.succeed(renameTask(input)),
    reviseTask: () => Effect.die("Unexpected Task revision call"),
  };
  return {
    ...environment(fakeTaskUseCases(), now),
    taskChangeTaskUseCases: coordinated,
  };
};

describe("Task command Adapters", () => {
  it.effect("renders every Task Cancel failure through its presentation policy", () =>
    Effect.gen(function* () {
      const taskId = publicTaskId("BY-1");
      const failureCases: ReadonlyArray<{
        readonly result: Extract<TaskCancellationResult, { readonly ok: false }>;
        readonly message: string;
        readonly help: readonly string[];
      }> = [
        {
          result: { ok: false, code: "task_not_found", taskId },
          message: "Task was not found: BY-1",
          help: ["Run `by task list --all --limit all` to see known Tasks."],
        },
        {
          result: { ok: false, code: "change_not_found", taskId },
          message: "Change for Task BY-1 was not found.",
          help: ["Inspect the Task and its Change linkage before retrying."],
        },
        {
          result: { ok: false, code: "task_already_done", taskId },
          message: "Cannot cancel completed Task BY-1.",
          help: ["Only unfinished Tasks can be cancelled."],
        },
        {
          result: { ok: false, code: "change_already_completed", taskId },
          message: "Task BY-1 is already complete through its Change.",
          help: ["Inspect the Change with `by change show <change-id>`."],
        },
        {
          result: { ok: false, code: "github_pull_request_unavailable", taskId },
          message: "The owned pull request could not be read, so the Task remains unfinished.",
          help: ["Restore GitHub access, then retry Task Cancel."],
        },
        {
          result: { ok: false, code: "owned_pull_request_mismatch", taskId },
          message:
            "The owned pull request does not match the recorded Change facts, so the Task remains unfinished.",
          help: ["Inspect the Change and resolve the remote mismatch before retrying."],
        },
        {
          result: {
            ok: false,
            code: "github_close_failed",
            taskId,
            evidence: {
              operation: "pull_request_close",
              classification: "rejected",
              exitStatus: 1,
            },
            recoveryEvidence: {
              operation: "remote_lookup",
              classification: "unavailable",
              reason: "unavailable",
            },
          },
          message: "The owned pull request could not be closed, so the Task remains unfinished.",
          help: ["Resolve the GitHub issue, then retry Task Cancel."],
        },
        {
          result: { ok: false, code: "submission_in_progress", taskId },
          message:
            "Another Submission or cancellation already owns this Change, so the Task remains unfinished.",
          help: ["Wait for the other operation to finish, then retry Task Cancel."],
        },
        {
          result: { ok: false, code: "active_validation_run", taskId, validationRunId: 42 },
          message: "A Validation Run remains active, so the Task remains unfinished.",
          help: [
            "After stopping every process from the run, execute `by validation-run abandon 42 --reason <reason>`.",
          ],
        },
      ];

      for (const failure of failureCases) {
        const cancellationUseCases: CancellationUseCases = {
          resolveTaskId: (id) => ({ ok: true, taskId: id }),
          cancelTask: () => Effect.succeed(failure.result),
          cancelChange: () => Effect.die("Unexpected Change Cancel call"),
        };
        const result = yield* runByInProcessEffect(
          createTestWorkspace(),
          ["task", "cancel", "BY-1", "--reason", "Stop"],
          firstNow,
          { cancellationUseCases },
        );

        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toEqual({
          error: {
            taskId: "BY-1",
            code: failure.result.code,
            message: failure.message,
            ...("validationRunId" in failure.result
              ? { validationRunId: failure.result.validationRunId }
              : {}),
            ...("evidence" in failure.result ? { evidence: failure.result.evidence } : {}),
            ...("recoveryEvidence" in failure.result
              ? { recoveryEvidence: failure.result.recoveryEvidence }
              : {}),
          },
          help: failure.help,
        });
      }
    }),
  );

  it("renders only valid Task Review recovery actions", () => {
    const running = taskReviewRecord({ state: "running", outcome: null });

    expect(taskReviewView(running).recovery.nextActions).toEqual([
      "Run `by task-review show 1` to inspect recovery.",
    ]);
    expect(
      taskReviewView(running, false, {
        verified: false,
        message: "The workspace identity is not proven.",
      }).recovery.nextActions,
    ).toEqual(["Resolve the reported Task Review identity problem."]);
    expect(
      taskReviewView(running, false, {
        verified: true,
        workspace: { state: "absent" },
      }).recovery.nextActions,
    ).toEqual([
      "Stop the Task Review process before abandonment.",
      'Run `by task review abandon 1 --reason "..."` after the process stops.',
    ]);
    expect(taskReviewView(taskReviewRecord()).recovery.nextActions).toEqual([]);
  });

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

  it.effect("renders concise Task Submission outcomes", () =>
    Effect.gen(function* () {
      const findings = [
        {
          title: "Ambiguous outcome",
          description: "Clarify the expected result.",
          evidence: "The proposal permits two outcomes.",
          files: ["docs/spec.md"],
        },
      ] as const;
      let calls = 0;
      const commandEnvironment: TaskCommandEnvironment = {
        ...environment(fakeTaskUseCases()),
        taskReviewSubmissionUseCases: {
          submit: () => {
            calls += 1;
            return Effect.succeed(
              calls === 1
                ? {
                    ok: true as const,
                    outcome: "passed" as const,
                    review: {
                      ...taskReviewRecord({ outcome: "passed" }),
                      state: "complete" as const,
                      outcome: "passed" as const,
                      findings: [],
                      toolingFailure: null,
                    },
                    task: { id: "BY-1", state: "todo" as const },
                  }
                : calls === 2
                  ? {
                      ok: true as const,
                      outcome: "blocked" as const,
                      review: {
                        ...taskReviewRecord({ outcome: "blocked", findings }),
                        state: "complete" as const,
                        outcome: "blocked" as const,
                        findings,
                        toolingFailure: null,
                      },
                      task: { id: "BY-1", state: "new" as const },
                    }
                  : {
                      ok: true as const,
                      outcome: "tooling_failed" as const,
                      review: {
                        ...taskReviewRecord({ outcome: "tooling_failed" }),
                        state: "complete" as const,
                        outcome: "tooling_failed" as const,
                        toolingFailure: {
                          operation: "confirm_task_review_context",
                          message: "Task title or description changed during review.",
                        },
                      },
                      task: { id: "BY-1", state: "new" as const },
                    },
            );
          },
        },
      };

      const passed = yield* runTaskSubmitCommand({ taskId: "BY-1" }, commandEnvironment);
      const blocked = yield* runTaskSubmitCommand({ taskId: "BY-1" }, commandEnvironment);
      const failed = yield* runTaskSubmitCommand({ taskId: "BY-1" }, commandEnvironment);

      expect(passed).toEqual({
        exitCode: 0,
        stdout: {
          review: { id: 1, state: "complete", outcome: "passed" },
          task: { id: "BY-1", state: "todo" },
          help: ["Run `by task show BY-1` to inspect its startability and next action."],
        },
      });
      expect(blocked).toEqual({
        exitCode: 1,
        stdout: {
          error: {
            code: "task_review_findings",
            message: "Task Review is blocked by Findings; the Task remains New.",
            review: { id: 1, state: "complete", outcome: "blocked", findings },
            task: { id: "BY-1", state: "new" },
          },
          help: ["Run `by task-review show 1` to inspect the Task Review."],
        },
      });
      expect(failed).toEqual({
        exitCode: 1,
        stdout: {
          error: {
            code: "task_review_tooling_failed",
            message: "Task Review had a Tooling Failure; the Task remains New.",
            review: {
              id: 1,
              state: "complete",
              outcome: "tooling_failed",
              toolingFailure: {
                operation: "confirm_task_review_context",
                message: "Task title or description changed during review.",
              },
            },
            task: { id: "BY-1", state: "new" },
          },
          help: ["Run `by task-review show 1` to inspect the Task Review."],
        },
      });
    }),
  );

  it.effect("maps a missing Task Review with bounded retry guidance", () =>
    Effect.gen(function* () {
      const result = yield* runTaskSubmitCommand(
        { taskId: "BY-1" },
        {
          ...environment(fakeTaskUseCases()),
          taskReviewSubmissionUseCases: {
            submit: () =>
              Effect.succeed({ ok: false as const, code: "task_review_not_found" as const }),
          },
        },
      );

      expect(result).toEqual({
        exitCode: 1,
        stdout: {
          error: {
            code: "task_review_not_found",
            message: "Task Review was not found while completing Task Submission.",
            taskId: "BY-1",
          },
          help: [
            "Run `by task reviews BY-1` to inspect Review history.",
            "Run `by task show BY-1` to inspect the current Task state.",
            "Retry `by task submit BY-1` only if the Task is still New and has no Active Review.",
          ],
        },
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
        id: 2,
        state: "complete",
        outcome: "blocked",
        workspaceCleanup: "removed",
        findings: [
          {
            title: "Ambiguous outcome",
            description: "Clarify the expected result.",
            evidence: "The proposal permits two outcomes.",
            files: ["docs/spec.md"],
          },
        ],
      });
      const commandEnvironment = environment(
        fakeTaskUseCases({
          getTaskForInspection: () => taskRecord({ title: "Inspect task", state: "todo" }),
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
          prerequisites: [],
          dependents: [],
          change: null,
          review: {
            id: 2,
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
              },
            ],
            workspaceCleanup: "removed",
            toolingFailure: null,
          },
        },
        contextCommand: "by task context BY-1",
        reviewCommand: "by task-review show 2",
        help: ["Run `by task revise BY-1` before changing approved Task intent."],
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

  it.effect("renders Task revision mutation and rejection results", () =>
    Effect.gen(function* () {
      const revised = taskRecord({ state: "new" });
      const successResult = yield* runReviseCommand(
        { taskId: "BY-1" },
        environment(
          fakeTaskUseCases(),
          secondNow,
          taskReviewInspection(),
          fakeTaskChangeTaskUseCases({
            reviseTask: () => ({ ok: true, changed: true, task: revised }),
          }),
        ),
      );
      const linkedResult = yield* runReviseCommand(
        { taskId: "BY-1" },
        environment(
          fakeTaskUseCases(),
          secondNow,
          taskReviewInspection(),
          fakeTaskChangeTaskUseCases({
            reviseTask: () => ({ ok: false, code: "task_change_linked", changeId: "change-1" }),
          }),
        ),
      );

      expect(successResult).toMatchObject({
        exitCode: 0,
        stdout: {
          task: { id: "BY-1", state: "new", changed: true },
          help: [
            "Edit Task BY-1 with `by task context draft BY-1` and `by task context apply BY-1`.",
          ],
        },
      });
      expect(linkedResult).toEqual({
        exitCode: 1,
        stdout: {
          error: {
            code: "task_change_linked",
            message: "Cannot revise Task BY-1 because it is linked to a Change.",
            taskId: "BY-1",
            changeId: "change-1",
          },
          help: ["Inspect the Change with `by change show change-1`."],
        },
      });
    }),
  );

  it.effect("renders Task Rename results and validates the normalized title", () =>
    Effect.gen(function* () {
      const renamed = taskRecord({ title: "Renamed task" });
      let input: unknown;
      const commandEnvironment = renameEnvironment((value) => {
        input = value;
        return { ok: true, noOp: false, task: renamed };
      }, secondNow);

      const result = yield* runRenameCommand(
        { taskId: "BY-1", title: "  Renamed task  " },
        commandEnvironment,
      );
      const noOp = yield* runRenameCommand(
        { taskId: "BY-1", title: "same" },
        renameEnvironment(() => ({
          ok: true,
          noOp: true,
          task: taskRecord({ title: "same" }),
        })),
      );
      const invalid = yield* runRenameCommand(
        { taskId: "BY-1", title: "line\nbreak" },
        commandEnvironment,
      );

      expect(input).toEqual({ taskId: "BY-1", title: "Renamed task" });
      expect(result).toEqual({
        exitCode: 0,
        stdout: { task: { id: "BY-1", title: "Renamed task", state: "new", noOp: false } },
      });
      expect(noOp).toEqual({
        exitCode: 0,
        stdout: { task: { id: "BY-1", title: "same", state: "new", noOp: true } },
      });
      expect(invalid).toMatchObject({
        exitCode: 2,
        stdout: { error: { code: "invalid_task_title" } },
      });
    }),
  );

  it.effect("renders Task Rename lifecycle and Change-link rejections", () =>
    Effect.gen(function* () {
      const cases = [
        {
          result: {
            ok: false as const,
            code: "task_revision_required" as const,
            state: "todo" as const,
          },
          code: "task_revision_required",
        },
        {
          result: { ok: false as const, code: "task_change_linked" as const, changeId: "BY-C1" },
          code: "task_change_linked",
        },
        {
          result: {
            ok: false as const,
            code: "invalid_task_state" as const,
            state: "done" as const,
          },
          code: "invalid_task_state",
        },
      ] as const;

      for (const testCase of cases) {
        const result = yield* runRenameCommand(
          { taskId: "BY-1", title: "New title" },
          renameEnvironment(() => testCase.result),
        );
        expect(result).toMatchObject({ exitCode: 1, stdout: { error: { code: testCase.code } } });
      }
    }),
  );

  it.effect("renders Task Context draft and application results", () =>
    Effect.gen(function* () {
      const persistedTask = taskRecord({
        description: "Updated description",
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
        task: { id: "BY-1", state: "new" },
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
          result: { ok: false, code: "task_revision_required", state: "todo" },
          code: "task_revision_required",
          command: "Run `by task revise BY-1` before changing approved Task intent.",
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
          },
        ],
      });
    }),
  );
});
