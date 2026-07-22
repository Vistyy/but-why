import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { publicTaskId } from "../src/task/taskId.js";
import type { TaskUseCases } from "../src/task/taskUseCases.js";
import { runByInProcessEffect } from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";
import { createInitializedRepo } from "./support/initializedRepo.js";
import { fakeTaskUseCases } from "./support/taskUseCases.js";

const firstNow = "2026-06-30T12:00:00.000Z";

type TaskGraph = {
  readonly prerequisites: readonly unknown[];
  readonly dependents: readonly unknown[];
};

const createTaskThroughCli = (
  root: string,
  title: string,
  dependencies: readonly string[] = [],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const descriptionFile = `${title.toLowerCase()}.md`;
    writeFileSync(join(root, descriptionFile), `Description for ${title}`);
    const result = yield* runByInProcessEffect(
      root,
      [
        "task",
        "create",
        "--title",
        title,
        "--description-file",
        descriptionFile,
        ...dependencies.flatMap((dependency) => ["--depends-on", dependency]),
        "--output",
        "json",
      ],
      firstNow,
    );
    expect(result.status).toBe(0);
  });

const readTaskGraph = (root: string, taskId: string): Effect.Effect<TaskGraph> =>
  Effect.gen(function* () {
    const result = yield* runByInProcessEffect(
      root,
      ["task", "show", taskId, "--output", "json"],
      firstNow,
    );
    expect(result.status).toBe(0);
    return (JSON.parse(result.stdout) as { readonly task: TaskGraph }).task;
  });

const expectJsonError = (
  result: { readonly status: number; readonly stderr: string; readonly stdout: string },
  expected: { readonly error: Record<string, unknown>; readonly help: readonly string[] },
): void => {
  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual(expected);
};

const dependencyErrorTaskUseCases = (overrides: Partial<TaskUseCases>): TaskUseCases => ({
  ...fakeTaskUseCases(),
  ...overrides,
});

const initializedRepositoryForChangeStart = (): string => {
  const root = createInitializedRepo();
  runGit(root, "config", "user.name", "But Why Test");
  runGit(root, "config", "user.email", "but-why@example.test");
  runGit(root, "branch", "-M", "main");
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  runGit(root, "add", "README.md", ".gitignore", ".but-why/config.json");
  runGit(root, "commit", "-m", "Initialize repository");
  runGit(root, "remote", "add", "origin", root);
  runGit(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  runGit(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const runGit = (cwd: string, ...args: readonly string[]): void => {
  execFileSync("git", args, { cwd, encoding: "utf8" });
};

describe("Task dependency graph", () => {
  it.effect("parses repeated dependency options", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const descriptionPath = join(root, "Dependent.md");
      let receivedDependencies: readonly string[] = [];
      writeFileSync(descriptionPath, "Description for Dependent");

      const result = yield* runByInProcessEffect(
        root,
        [
          "task",
          "create",
          "--title",
          "Dependent",
          "--description-file",
          descriptionPath,
          "--depends-on",
          "BY-1",
          "--depends-on",
          "BY-2",
          "--output",
          "json",
        ],
        firstNow,
        {
          taskUseCases: fakeTaskUseCases({
            createTask: (input) => {
              receivedDependencies = input.dependsOn ?? [];
              return {
                id: "BY-3",
                title: input.title,
                state: "new",
                createdAt: input.now,
                updatedAt: input.now,
                startable: false,
                blockedBy: [],
              };
            },
          }),
        },
      );

      expect(result.status).toBe(0);
      expect(receivedDependencies).toEqual(["BY-1", "BY-2"]);
    }),
  );
});

it.effect("reports Task creation dependency rejections without changing the graph", () =>
  Effect.gen(function* () {
    const root = createInitializedRepo();
    writeFileSync(join(root, "first.md"), "Description for First");

    expect(
      (yield* runByInProcessEffect(
        root,
        [
          "task",
          "create",
          "--title",
          "First",
          "--description-file",
          "first.md",
          "--output",
          "json",
        ],
        firstNow,
      )).status,
    ).toBe(0);
    const before = yield* readTaskGraph(root, "BY-1");

    for (const testCase of [
      {
        name: "unknown dependency",
        dependencyArgs: ["BY-404"],
        error: {
          code: "dependency_unknown_task",
          message: "Dependency Task was not found: BY-404",
          taskId: "BY-404",
        },
      },
      {
        name: "self-dependency",
        dependencyArgs: ["BY-2"],
        error: {
          code: "dependency_self",
          message: "A Task cannot depend on itself.",
          taskId: "BY-2",
        },
      },
      {
        name: "duplicate dependency",
        dependencyArgs: ["BY-1", "BY-1"],
        error: {
          code: "dependency_duplicate",
          message: "Dependency was provided more than once: BY-1",
          taskId: "BY-1",
        },
      },
    ] as const) {
      writeFileSync(join(root, `${testCase.name}.md`), `Description for ${testCase.name}`);
      const result = yield* runByInProcessEffect(
        root,
        [
          "task",
          "create",
          "--title",
          testCase.name,
          "--description-file",
          `${testCase.name}.md`,
          ...testCase.dependencyArgs.flatMap((dependency) => ["--depends-on", dependency]),
          "--output",
          "json",
        ],
        firstNow,
      );

      expectJsonError(result, {
        error: testCase.error,
        help: ["Use existing Tasks from `by task list --all` as direct prerequisites."],
      });
      expect(yield* readTaskGraph(root, "BY-1")).toEqual(before);
    }
  }),
);

it.effect("maps Task creation dependency cycles through the public CLI contract", () =>
  Effect.gen(function* () {
    const root = createTestWorkspace();
    writeFileSync(join(root, "cycle.md"), "Description for Cycle");
    // A valid create operation cannot form a cycle because its new ID is not yet referenced.
    const taskUseCases = dependencyErrorTaskUseCases({
      createTask: () => Effect.succeed({ ok: false, code: "dependency_cycle" }),
    });

    const result = yield* runByInProcessEffect(
      root,
      [
        "task",
        "create",
        "--title",
        "Cycle",
        "--description-file",
        "cycle.md",
        "--depends-on",
        "BY-1",
        "--output",
        "json",
      ],
      firstNow,
      { taskUseCases },
    );

    expectJsonError(result, {
      error: {
        code: "dependency_cycle",
        message: "Task dependencies must not contain a cycle.",
      },
      help: ["Use existing Tasks from `by task list --all` as direct prerequisites."],
    });
  }),
);

it.effect("reports dependency replacement rejections without changing the graph", () =>
  Effect.gen(function* () {
    const root = createInitializedRepo();
    yield* createTaskThroughCli(root, "First");
    yield* createTaskThroughCli(root, "Second");
    yield* createTaskThroughCli(root, "Dependent", ["BY-1"]);
    const before = yield* readTaskGraph(root, "BY-3");

    for (const testCase of [
      {
        name: "unknown dependency",
        taskId: "BY-3",
        dependencyArgs: ["BY-404"],
        error: {
          code: "dependency_unknown_task",
          message: "Dependency Task was not found: BY-404",
          taskId: "BY-3",
          dependencyTaskId: "BY-404",
        },
      },
      {
        name: "self-dependency",
        taskId: "BY-3",
        dependencyArgs: ["BY-3"],
        error: {
          code: "dependency_self",
          message: "Task BY-3 cannot depend on itself.",
          taskId: "BY-3",
          dependencyTaskId: "BY-3",
        },
      },
      {
        name: "duplicate dependency",
        taskId: "BY-3",
        dependencyArgs: ["BY-1", "BY-1"],
        error: {
          code: "dependency_duplicate",
          message: "Dependency was provided more than once: BY-1",
          taskId: "BY-3",
          dependencyTaskId: "BY-1",
        },
      },
    ] as const) {
      const result = yield* runByInProcessEffect(
        root,
        [
          "task",
          "dependencies",
          "set",
          testCase.taskId,
          ...testCase.dependencyArgs.flatMap((dependency) => ["--depends-on", dependency]),
          "--output",
          "json",
        ],
        firstNow,
      );

      expectJsonError(result, {
        error: testCase.error,
        help: ["Use existing Tasks and keep the direct dependency graph acyclic."],
      });
      expect(yield* readTaskGraph(root, "BY-3")).toEqual(before);
    }

    const missingTask = yield* runByInProcessEffect(
      root,
      ["task", "dependencies", "set", "BY-404", "--output", "json"],
      firstNow,
    );
    expectJsonError(missingTask, {
      error: {
        code: "task_not_found",
        message: "Task was not found: BY-404",
        taskId: "BY-404",
      },
      help: ["Run `by task list --all` to see known Tasks."],
    });
    expect(yield* readTaskGraph(root, "BY-3")).toEqual(before);
  }),
);

it.effect("reports dependency cycles through replacement without changing the graph", () =>
  Effect.gen(function* () {
    const root = createInitializedRepo();
    yield* createTaskThroughCli(root, "First");
    yield* createTaskThroughCli(root, "Second", ["BY-1"]);
    yield* createTaskThroughCli(root, "Third", ["BY-2"]);
    const before = yield* readTaskGraph(root, "BY-1");

    const result = yield* runByInProcessEffect(
      root,
      ["task", "dependencies", "set", "BY-1", "--depends-on", "BY-3", "--output", "json"],
      firstNow,
    );

    expectJsonError(result, {
      error: {
        code: "dependency_cycle",
        message: "Task dependencies must not contain a cycle.",
        taskId: "BY-1",
      },
      help: ["Use existing Tasks and keep the direct dependency graph acyclic."],
    });
    expect(yield* readTaskGraph(root, "BY-1")).toEqual(before);
  }),
);

it.effect("rejects locked dependency replacement without changing the graph", () =>
  Effect.gen(function* () {
    const root = initializedRepositoryForChangeStart();
    yield* createTaskThroughCli(root, "Started Task");
    const approved = yield* runByInProcessEffect(
      root,
      ["task", "approve", "BY-1", "--output", "json"],
      firstNow,
    );
    expect(approved.status).toBe(0);
    const started = yield* runByInProcessEffect(
      root,
      ["change", "start", "--task", "BY-1", "--output", "json"],
      firstNow,
    );
    expect(started.status).toBe(0);
    const before = yield* readTaskGraph(root, "BY-1");

    const result = yield* runByInProcessEffect(
      root,
      ["task", "dependencies", "set", "BY-1", "--output", "json"],
      firstNow,
    );

    expectJsonError(result, {
      error: {
        code: "dependencies_locked",
        message: "Dependencies for task BY-1 are locked after Start.",
        taskId: "BY-1",
        state: "implementing",
      },
      help: ["Dependency edits are available only before Change Start."],
    });
    expect(yield* readTaskGraph(root, "BY-1")).toEqual(before);
  }),
);

it.effect("routes dependency replacement and maps dependency errors through the CLI", () =>
  Effect.gen(function* () {
    const root = createTestWorkspace();
    let received: readonly string[] = [];
    const task = {
      id: "BY-3",
      title: "Dependent",
      description: "Description",
      state: "new" as const,
      createdAt: firstNow,
      updatedAt: firstNow,
      startable: false,
      blockedBy: [],
      commentCount: 0,
      prerequisites: [
        { id: "BY-1", title: "First", state: "new" as const },
        { id: "BY-2", title: "Second", state: "new" as const },
      ],
      dependents: [],
    };
    const success = yield* runByInProcessEffect(
      root,
      [
        "task",
        "dependencies",
        "set",
        "BY-3",
        "--depends-on",
        "BY-1",
        "--depends-on",
        "BY-2",
        "--output",
        "json",
      ],
      firstNow,
      {
        taskUseCases: fakeTaskUseCases({
          replaceTaskDependencies: (_taskId, prerequisiteTaskIds) => {
            received = prerequisiteTaskIds;
            return { ok: true, task };
          },
        }),
      },
    );

    expect(success.status).toBe(0);
    expect(received).toEqual(["BY-1", "BY-2"]);
    expect(JSON.parse(success.stdout)).toEqual({
      task: { id: "BY-3", prerequisites: task.prerequisites },
    });

    const failure = yield* runByInProcessEffect(
      root,
      ["task", "dependencies", "set", "BY-3", "--depends-on", "BY-3"],
      firstNow,
      {
        taskUseCases: fakeTaskUseCases({
          replaceTaskDependencies: () => ({
            ok: false,
            code: "dependency_self",
            taskId: publicTaskId("BY-3"),
          }),
        }),
      },
    );

    expect(failure.status).toBe(1);
    expect(failure.stdout).toContain("code: dependency_self");
    expect(failure.stdout).toContain("Task BY-3 cannot depend on itself.");
  }),
);
