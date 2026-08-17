import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { RepositoryStateUnavailable } from "../../src/contracts/repositoryStorageError.js";
import type { LocalRepositoryContext } from "../../src/repositoryRuntime/repositoryContext.js";
import type { TaskRecord } from "../../src/task/task.js";
import { publicTaskId, taskSlugForId } from "../../src/task/taskId.js";
import type { TaskPersistence } from "../../src/task/taskPersistence.js";
import type { UpdateTaskContextResult } from "../../src/task/taskStore.js";
import { openTaskUseCases } from "../../src/task/taskUseCases.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const taskId = publicTaskId("BY-1");
const secondNow = "2026-06-30T12:05:00.000Z";

const task = (description = "Original description"): TaskRecord => ({
  id: taskId,
  title: "Original title",
  description,
  state: "new",
  cancelReason: null,
  startable: false,
  blockedBy: [],
  prerequisites: [],
  dependents: [],
});

const contextFor = (root: string): LocalRepositoryContext => {
  const operationalDir = join(root, ".git", "but-why");
  const butWhyDir = join(root, ".but-why");
  return {
    root,
    mainCheckoutRoot: root,
    commonDirectory: join(root, ".git"),
    idPrefix: "BY",
    config: { idPrefix: "BY" },
    paths: {
      butWhyDir,
      operationalDir,
      configPath: join(butWhyDir, "config.json"),
      statePath: join(operationalDir, "state.sqlite"),
      reviewersPath: join(butWhyDir, "reviewers"),
      artifactsPath: join(operationalDir, "artifacts"),
      snapshotsPath: join(operationalDir, "snapshots"),
      taskContextDraftsPath: join(operationalDir, "task-context-drafts"),
    },
  };
};

const unexpected = (operation: string): never => {
  throw new Error(`Unexpected TaskPersistence.${operation} call`);
};

const persistence = (overrides: Partial<TaskPersistence> = {}): TaskPersistence => ({
  createTask: () => unexpected("createTask"),
  editTaskDependencies: () => unexpected("editTaskDependencies"),
  listTasks: () => unexpected("listTasks"),
  listActionableTasks: () => unexpected("listActionableTasks"),
  getTaskById: () => unexpected("getTaskById"),
  getTaskContextById: () => unexpected("getTaskContextById"),
  updateTaskContext: () => unexpected("updateTaskContext"),
  reviseTask: () => unexpected("reviseTask"),
  cancelTask: () => unexpected("cancelTask"),
  ...overrides,
});

const successfulUpdate = (description: string): UpdateTaskContextResult => {
  const updated = { ...task(description), updatedAt: secondNow };
  return {
    ok: true,
    task: updated,
    context: { id: taskId, title: updated.title, description },
  };
};

describe("Task Context draft use cases", () => {
  it.effect("creates and replaces a draft from the current Task Context", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const context = contextFor(root);
      let description = "Original description";
      const tasks = openTaskUseCases(
        context,
        persistence({
          getTaskContextById: () =>
            Effect.succeed({ id: taskId, title: "Original title", description }),
        }),
      );

      const first = yield* tasks.createTaskContextDraft(taskId);
      expect(first).toBeDefined();
      if (first === undefined) return;
      expect(first.content).toBe("Original description");
      expect(readFileSync(first.path, "utf8")).toBe(first.content);

      writeFileSync(first.path, "Discarded local edit");
      description = "Current description";
      const replacement = yield* tasks.createTaskContextDraft(taskId);

      expect(replacement).toEqual({ path: first.path, content: "Current description" });
      expect(readFileSync(first.path, "utf8")).toBe("Current description");
    }),
  );

  it.effect("returns no draft for an unknown Task and classifies write failures", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const context = contextFor(root);
      const missing = openTaskUseCases(
        context,
        persistence({ getTaskContextById: () => Effect.succeed(undefined) }),
      );
      expect(yield* missing.createTaskContextDraft(taskId)).toBeUndefined();

      mkdirSync(context.paths.operationalDir, { recursive: true });
      writeFileSync(context.paths.taskContextDraftsPath, "not a directory");
      const unavailable = openTaskUseCases(
        context,
        persistence({
          getTaskContextById: () =>
            Effect.succeed({
              id: taskId,
              title: "Original title",
              description: "Original description",
            }),
        }),
      );
      const result = yield* Effect.either(unavailable.createTaskContextDraft(taskId));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") expect(result.left).toBeInstanceOf(RepositoryStateUnavailable);
    }),
  );

  it.effect("applies the complete draft and removes it after persistence succeeds", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const context = contextFor(root);
      let appliedDescription: string | undefined;
      const tasks = openTaskUseCases(
        context,
        persistence({
          getTaskContextById: () =>
            Effect.succeed({
              id: taskId,
              title: "Original title",
              description: "Original description",
            }),
          updateTaskContext: (input) => {
            appliedDescription = input.description;
            return Effect.succeed(successfulUpdate(input.description));
          },
        }),
      );
      const draft = yield* tasks.createTaskContextDraft(taskId);
      if (draft === undefined) throw new Error("Expected Task Context draft");
      const description = "# Heading\n\nUpdated description\n\n";
      writeFileSync(draft.path, description);

      const result = yield* tasks.applyTaskContextDraft({ taskId, now: secondNow });

      expect(result).toMatchObject({
        ok: true,
        task: { title: "Original title", description },
        context: { title: "Original title", description },
      });
      expect(appliedDescription).toBe(description);
      expect(existsSync(draft.path)).toBe(false);
    }),
  );

  it.effect("rejects missing, unreadable, invalid UTF-8, and blank drafts before persistence", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const context = contextFor(root);
      let updateCalls = 0;
      const tasks = openTaskUseCases(
        context,
        persistence({
          updateTaskContext: () => {
            updateCalls += 1;
            return Effect.succeed(successfulUpdate("unexpected"));
          },
        }),
      );

      const missing = yield* tasks.applyTaskContextDraft({ taskId, now: secondNow });
      expect(missing).toMatchObject({ ok: false, error: { code: "task_context_draft_not_found" } });

      const draftPath = join(context.paths.taskContextDraftsPath, `${taskSlugForId(taskId)}.md`);
      mkdirSync(draftPath, { recursive: true });
      const unreadable = yield* tasks.applyTaskContextDraft({ taskId, now: secondNow });
      expect(unreadable).toMatchObject({
        ok: false,
        error: { code: "task_context_draft_unreadable" },
      });

      // Replace the directory at the deterministic draft path with malformed content.
      rmSync(draftPath, { recursive: true });
      writeFileSync(draftPath, Buffer.from([0xff]));
      const invalidUtf8 = yield* tasks.applyTaskContextDraft({ taskId, now: secondNow });
      expect(invalidUtf8).toMatchObject({
        ok: false,
        error: { code: "task_context_draft_unreadable" },
      });

      writeFileSync(draftPath, " \n\t");
      const blank = yield* tasks.applyTaskContextDraft({ taskId, now: secondNow });
      expect(blank).toMatchObject({ ok: false, error: { code: "invalid_task_context_draft" } });
      expect(existsSync(draftPath)).toBe(true);
      expect(updateCalls).toBe(0);
    }),
  );

  it.effect("retains the draft when Task persistence rejects the application", () =>
    Effect.gen(function* () {
      for (const rejected of [
        { ok: false as const, code: "task_not_found" as const },
        { ok: false as const, code: "invalid_task_state" as const, state: "todo" as const },
        { ok: false as const, code: "invalid_task_state" as const, state: "done" as const },
        { ok: false as const, code: "invalid_task_state" as const, state: "cancelled" as const },
      ]) {
        const root = createTestWorkspace();
        const context = contextFor(root);
        const tasks = openTaskUseCases(
          context,
          persistence({ updateTaskContext: () => Effect.succeed(rejected) }),
        );
        mkdirSync(context.paths.taskContextDraftsPath, { recursive: true });
        const draftPath = join(context.paths.taskContextDraftsPath, `${taskSlugForId(taskId)}.md`);
        writeFileSync(draftPath, "Updated description");

        expect(yield* tasks.applyTaskContextDraft({ taskId, now: secondNow })).toEqual(rejected);
        expect(readFileSync(draftPath, "utf8")).toBe("Updated description");
      }
    }),
  );

  it.effect("reports cleanup failure with the persisted Task result", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const context = contextFor(root);
      const draftPath = join(context.paths.taskContextDraftsPath, `${taskSlugForId(taskId)}.md`);
      mkdirSync(context.paths.taskContextDraftsPath, { recursive: true });
      writeFileSync(draftPath, "Updated description");
      const tasks = openTaskUseCases(
        context,
        persistence({
          updateTaskContext: (input) => {
            if (input.taskId !== taskId) throw new Error("Unexpected Task ID");
            rmSync(draftPath, { force: true });
            mkdirSync(draftPath);
            return Effect.succeed(successfulUpdate(input.description));
          },
        }),
      );

      const result = yield* tasks.applyTaskContextDraft({ taskId, now: secondNow });

      expect(result).toMatchObject({
        ok: false,
        code: "task_context_draft_cleanup_failed",
        task: { description: "Updated description" },
        path: draftPath,
      });
    }),
  );
});
