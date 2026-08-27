import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { runByInProcessEffect } from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";

const parse = (stdout: string): unknown => JSON.parse(stdout) as unknown;

const withRepository = <A, E>(use: (root: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => createInitializedRepo()),
    use,
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

const createTask = (root: string, file: string, title: string, description: string) => {
  writeFileSync(join(root, file), description);
  return runByInProcessEffect(root, ["task", "create", "--title", title, "--file", file]);
};

it.effect("renders Task list and detail projections", () =>
  withRepository((root) =>
    Effect.gen(function* () {
      expect((yield* createTask(root, "first.md", "First", "First intent")).status).toBe(0);
      expect((yield* createTask(root, "second.md", "Second", "Second intent")).status).toBe(0);

      const list = yield* runByInProcessEffect(root, ["task", "list"]);
      expect(list.status).toBe(0);
      expect(parse(list.stdout)).toMatchObject({
        count: 2,
        total: 2,
        tasks: [
          { id: "BY-1", title: "First", change: null },
          { id: "BY-2", title: "Second", change: null },
        ],
      });

      const show = yield* runByInProcessEffect(root, ["task", "show", "BY-1"]);
      expect(show.status).toBe(0);
      expect(parse(show.stdout)).toMatchObject({
        task: {
          id: "BY-1",
          title: "First",
          prerequisites: [],
          dependents: [],
          change: null,
        },
      });
    }),
  ),
);

it.effect("renders dependency success and validation failures", () =>
  withRepository((root) =>
    Effect.gen(function* () {
      expect((yield* createTask(root, "first.md", "First", "First intent")).status).toBe(0);
      expect((yield* createTask(root, "second.md", "Second", "Second intent")).status).toBe(0);

      const added = yield* runByInProcessEffect(root, [
        "task",
        "dependencies",
        "add",
        "BY-2",
        "--depends-on",
        "BY-1",
      ]);
      expect(added.status).toBe(0);
      expect(parse(added.stdout)).toMatchObject({
        task: { id: "BY-2" },
        operation: "add",
        prerequisites: [{ id: "BY-1", title: "First", state: "new" }],
      });

      const unknown = yield* runByInProcessEffect(root, [
        "task",
        "dependencies",
        "add",
        "BY-2",
        "--depends-on",
        "BY-404",
      ]);
      expect(unknown.status).toBe(1);
      expect(parse(unknown.stdout)).toMatchObject({
        error: { code: "dependency_unknown_task", taskId: "BY-2", dependencyTaskId: "BY-404" },
      });

      const missing = yield* runByInProcessEffect(root, [
        "task",
        "dependencies",
        "replace",
        "BY-2",
      ]);
      expect(missing.status).toBe(2);
      expect(parse(missing.stdout)).toMatchObject({
        error: { code: "replace_requires_dependency" },
      });
    }),
  ),
);

it.effect("renders Task Context, rename, and revision contracts", () =>
  withRepository((root) =>
    Effect.gen(function* () {
      expect((yield* createTask(root, "task.md", "Original", "Original intent")).status).toBe(0);

      const renamed = yield* runByInProcessEffect(root, [
        "task",
        "rename",
        "BY-1",
        "--title",
        "Renamed",
      ]);
      expect(renamed.status).toBe(0);
      expect(parse(renamed.stdout)).toMatchObject({
        task: { id: "BY-1", title: "Renamed", state: "new", noOp: false },
      });

      const revised = yield* runByInProcessEffect(root, ["task", "revise", "BY-1"]);
      expect(revised.status).toBe(0);
      expect(parse(revised.stdout)).toMatchObject({ task: { id: "BY-1", changed: false } });

      const draft = yield* runByInProcessEffect(root, ["task", "context", "draft", "BY-1"]);
      expect(draft.status).toBe(0);
      const draftPath = (parse(draft.stdout) as { readonly draft: { readonly path: string } }).draft
        .path;
      writeFileSync(draftPath, " \n\t");
      const invalid = yield* runByInProcessEffect(root, ["task", "context", "apply", "BY-1"]);
      expect(invalid.status).toBe(1);
      expect(parse(invalid.stdout)).toMatchObject({
        error: { code: "invalid_task_context_draft" },
      });
      expect(readdirSync(join(root, ".git", "but-why", "task-context-drafts"))).toHaveLength(1);
    }),
  ),
);
