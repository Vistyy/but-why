import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { openRepositoryRuntime } from "../../src/repositoryRuntime/repositoryRuntime.js";
import { createTask } from "../../src/task/composition/createTask.js";
import {
  type ApplyTaskContextDraftResult,
  applyTaskContextDraft,
  createTaskContextDraft,
} from "../../src/task/composition/taskContext.js";
import { internalTaskId, publicTaskId } from "../../src/task/taskId.js";
import { createInitializedRepo } from "../support/initializedRepo.js";

const now = "2026-10-04T12:00:00.000Z";
const later = "2026-10-04T12:05:00.000Z";

const withRepository = <A, E>(use: (root: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => createInitializedRepo()),
    use,
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

const createTestTask = (root: string, description = "Original description") =>
  Effect.map(createTask(root, { title: "Original title", description, now }), (result) => {
    if (!result.ok) throw new Error(result.code);
    return result.task;
  });

const setTaskState = (root: string, taskId: string, state: "todo" | "done" | "cancelled") => {
  const loaded = openRepositoryRuntime(root);
  if (!loaded.ok) throw new Error(loaded.error.code);
  return loaded.runtime.provide(
    Effect.flatMap(RepositorySql, (repository) =>
      repository.operation(
        "set Task Context draft fixture state",
        (sql) => sql`
          UPDATE tasks SET state = ${state}, cancel_reason = ${state === "cancelled" ? "fixture" : null}
          WHERE id = ${internalTaskId(publicTaskId(taskId), repository.idPrefix)}
        `,
      ),
    ),
  );
};

it.effect("creates and replaces Task Context drafts from current intent", () =>
  withRepository((root) =>
    Effect.gen(function* () {
      yield* createTestTask(root);
      const first = yield* createTaskContextDraft(root, publicTaskId("BY-1"));
      if (first === undefined) throw new Error("Expected Task Context draft");
      expect(readFileSync(first.path, "utf8")).toBe("Original description");

      writeFileSync(first.path, "Discarded local edit");
      const replacement = yield* createTaskContextDraft(root, publicTaskId("BY-1"));
      expect(replacement).toEqual({ path: first.path, content: "Original description" });
      expect(readFileSync(first.path, "utf8")).toBe("Original description");
    }),
  ),
);

it.effect("rejects malformed drafts before persistence and retains them", () =>
  withRepository((root) =>
    Effect.gen(function* () {
      yield* createTestTask(root);
      const draft = yield* createTaskContextDraft(root, publicTaskId("BY-1"));
      if (draft === undefined) throw new Error("Expected Task Context draft");

      writeFileSync(draft.path, Buffer.from([0xff]));
      expect(
        yield* applyTaskContextDraft(root, { taskId: publicTaskId("BY-1"), now: later }),
      ).toMatchObject({
        ok: false,
        error: { code: "task_context_draft_unreadable" },
      });

      writeFileSync(draft.path, " \n\t");
      expect(
        yield* applyTaskContextDraft(root, { taskId: publicTaskId("BY-1"), now: later }),
      ).toMatchObject({
        ok: false,
        error: { code: "invalid_task_context_draft" },
      });
      expect(existsSync(draft.path)).toBe(true);
    }),
  ),
);

it.effect("retains drafts after Task persistence rejection", () =>
  withRepository((root) =>
    Effect.gen(function* () {
      yield* createTestTask(root);
      const draft = yield* createTaskContextDraft(root, publicTaskId("BY-1"));
      if (draft === undefined) throw new Error("Expected Task Context draft");
      writeFileSync(draft.path, "Updated description");
      yield* setTaskState(root, "BY-1", "todo");

      expect(
        yield* applyTaskContextDraft(root, { taskId: publicTaskId("BY-1"), now: later }),
      ).toEqual({
        ok: false,
        code: "task_revision_required",
        state: "todo",
      });
      expect(readFileSync(draft.path, "utf8")).toBe("Updated description");
    }),
  ),
);

it.effect("reports cleanup failure after a successful Task Context persistence", () =>
  withRepository((root) =>
    Effect.gen(function* () {
      yield* createTestTask(root);
      const draft = yield* createTaskContextDraft(root, publicTaskId("BY-1"));
      if (draft === undefined) throw new Error("Expected Task Context draft");
      writeFileSync(draft.path, "Updated description");
      const draftsPath = join(root, ".git", "but-why", "task-context-drafts");
      chmodSync(draftsPath, 0o500);
      let result: ApplyTaskContextDraftResult;
      try {
        result = yield* applyTaskContextDraft(root, { taskId: publicTaskId("BY-1"), now: later });
      } finally {
        chmodSync(draftsPath, 0o700);
      }

      expect(result).toMatchObject({
        ok: false,
        code: "task_context_draft_cleanup_failed",
        task: { description: "Updated description" },
        path: draft.path,
      });
      expect(readFileSync(draft.path, "utf8")).toBe("Updated description");
    }),
  ),
);
