import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { builtByExecutable, createGitRepo, repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const commandEnv = {
  ...process.env,
  FORCE_COLOR: "0",
  NO_COLOR: "1",
};

const run = (command: string, args: readonly string[], cwd: string) =>
  spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: commandEnv,
  });

const expectSuccess = (result: ReturnType<typeof run>): void => {
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
};

const documentedCommands = [
  "by task create --title <title> --description-file <file> [--depends-on <task-id>]...",
  "by task dependencies set <task-id> [--depends-on <task-id>]...",
  "by task list [--all] [--state <state>]",
  "by task show <task-id>",
  "by task approve <task-id>",
  "by task context <task-id>",
  "by task context draft <task-id>",
  "by task context apply <task-id>",
  "by task comment <task-id> --file <file>",
  "by task cancel <task-id> --reason <reason>",
  "by change start [--task <task-id>]",
  "by change prepare <change-id>",
  "by change list [--all]",
  "by change show <change-id>",
  "by change findings <change-id>",
  "by change validation-runs <change-id>",
  "by change submit <change-id>",
  "by change cancel <change-id>",
  "by change reconcile [<change-id>]",
  "by change implement <change-id> [--handoff-file <path>]",
] as const;

describe("installed manual workflow", () => {
  it("keeps public workflow command templates aligned with the installed package", () => {
    const setup = readFileSync(join(repoRoot, "docs/public/setup.md"), "utf8");
    const config = readFileSync(join(repoRoot, "docs/public/config.md"), "utf8");
    const docs = `${setup}\n${config}`;

    for (const command of documentedCommands) expect(docs).toContain(command);

    expect(docs).not.toMatch(
      /\/code-review|\bAFK\b|\bFixer\b|Final Review|PR Writer|Supervisor|remediation/iu,
    );
    expect(docs).toContain("--output json");
    expect(docs).toContain("by change submit <change-id>");
    expect(docs).toContain("human merge");
  });

  it("runs the installed package from another Git repository", () => {
    builtByExecutable();
    const packageDirectory = createTestWorkspace();
    const consumer = createGitRepo();
    writeFileSync(join(consumer, "README.md"), "consumer repository\n");
    expectSuccess(run("git", ["add", "README.md"], consumer));
    expectSuccess(
      run(
        "git",
        [
          "-c",
          "user.name=But Why Test",
          "-c",
          "user.email=but-why@example.test",
          "commit",
          "-m",
          "Initial commit",
        ],
        consumer,
      ),
    );
    expectSuccess(run("git", ["branch", "-M", "main"], consumer));
    expectSuccess(run("git", ["remote", "add", "origin", consumer], consumer));
    expectSuccess(
      run("git", ["update-ref", "refs/remotes/origin/main", "refs/heads/main"], consumer),
    );
    expectSuccess(
      run(
        "git",
        ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
        consumer,
      ),
    );
    const packed = run(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packageDirectory],
      repoRoot,
    );
    expectSuccess(packed);
    const [metadata] = JSON.parse(packed.stdout) as readonly { readonly filename: string }[];
    if (metadata === undefined) throw new Error("npm pack did not return a package");

    const installed = run("npm", ["init", "--yes"], consumer);
    expectSuccess(installed);
    expectSuccess(
      run(
        "npm",
        [
          "install",
          "--offline",
          "--no-audit",
          "--no-fund",
          join(packageDirectory, metadata.filename),
        ],
        consumer,
      ),
    );

    const by = join(consumer, "node_modules/.bin/by");
    expect(existsSync(by)).toBe(true);
    const taskHelp = run(by, ["task", "--help"], consumer);
    const changeHelp = run(by, ["change", "--help"], consumer);
    expectSuccess(taskHelp);
    expectSuccess(changeHelp);
    const installedHelp = `${taskHelp.stdout}\n${changeHelp.stdout}`;
    for (const command of documentedCommands) expect(installedHelp).toContain(command);

    const initialized = run(by, ["init", "--task-prefix", "BY"], consumer);
    expectSuccess(initialized);
    expect(initialized.stdout).toContain("status: initialized");
    expect(readFileSync(join(consumer, ".but-why/config.json"), "utf8")).toContain(
      '"taskPrefix": "BY"',
    );
    expect(existsSync(join(consumer, ".git", "but-why", "state.sqlite"))).toBe(true);

    writeFileSync(
      join(consumer, ".but-why/config.json"),
      `${JSON.stringify(
        {
          taskPrefix: "BY",
          prepare: {
            command:
              "if [ -f .prepare-attempted ]; then exit 0; else touch .prepare-attempted; exit 7; fi",
          },
          validation: { checks: [{ id: "quality", command: "true" }] },
        },
        null,
        2,
      )}\n`,
    );
    expectSuccess(run("git", ["add", ".but-why/config.json", ".gitignore"], consumer));
    expectSuccess(
      run(
        "git",
        [
          "-c",
          "user.name=But Why Test",
          "-c",
          "user.email=but-why@example.test",
          "commit",
          "-m",
          "Configure manual workflow",
        ],
        consumer,
      ),
    );

    const tasklessStart = run(by, ["change", "start", "--output", "json"], consumer);
    expect(tasklessStart.status).toBe(1);
    const tasklessFailure = JSON.parse(tasklessStart.stdout) as {
      readonly error: {
        readonly changeId: string;
        readonly readiness: string;
        readonly worktreePath: string;
      };
    };
    expect(tasklessFailure.error).toMatchObject({
      changeId: expect.any(String),
      readiness: "prepare_failed",
      worktreePath: expect.any(String),
    });
    expect(existsSync(tasklessFailure.error.worktreePath)).toBe(true);

    const tasklessId = tasklessFailure.error.changeId;
    const prepared = run(by, ["change", "prepare", tasklessId, "--output", "json"], consumer);
    expectSuccess(prepared);
    const tasklessChange = JSON.parse(prepared.stdout) as {
      readonly change: {
        readonly id: string;
        readonly taskId: string | null;
        readonly readiness: string;
      };
      readonly worktreePath: string;
    };
    expect(tasklessChange).toMatchObject({
      change: { id: tasklessId, taskId: null, readiness: "ready" },
      worktreePath: tasklessFailure.error.worktreePath,
    });

    const shown = run(by, ["change", "show", tasklessId, "--output", "json"], consumer);
    expectSuccess(shown);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      change: { id: tasklessId, taskId: null, readiness: "ready", state: "open" },
    });
    rmSync(join(tasklessChange.worktreePath, ".prepare-attempted"));

    const nothingToSubmit = run(by, ["change", "submit", tasklessId, "--output", "json"], consumer);
    expectSuccess(nothingToSubmit);
    expect(JSON.parse(nothingToSubmit.stdout)).toMatchObject({
      changeId: tasklessId,
      status: "nothing_to_submit",
    });

    writeFileSync(join(tasklessChange.worktreePath, "manual.txt"), "manual implementation\n");
    expectSuccess(run("git", ["add", "manual.txt"], tasklessChange.worktreePath));
    expectSuccess(
      run(
        "git",
        [
          "-c",
          "user.name=But Why Test",
          "-c",
          "user.email=but-why@example.test",
          "commit",
          "-m",
          "Implement manually",
        ],
        tasklessChange.worktreePath,
      ),
    );

    const cancelled = run(by, ["change", "cancel", tasklessId, "--output", "json"], consumer);
    expectSuccess(cancelled);
    expect(JSON.parse(cancelled.stdout)).toMatchObject({
      status: "cancelled",
      change: { id: tasklessId, state: "closed" },
    });

    const descriptionPath = join(consumer, "task.md");
    writeFileSync(descriptionPath, "Ship the manual workflow.\n");
    const createdTask = run(
      by,
      [
        "task",
        "create",
        "--title",
        "Ship the manual workflow",
        "--description-file",
        descriptionPath,
        "--output",
        "json",
      ],
      consumer,
    );
    expectSuccess(createdTask);
    const taskId = (JSON.parse(createdTask.stdout) as { readonly task: { readonly id: string } })
      .task.id;
    expectSuccess(run(by, ["task", "approve", taskId, "--output", "json"], consumer));

    const taskBackedStart = run(
      by,
      ["change", "start", "--task", taskId, "--output", "json"],
      consumer,
    );
    expect(taskBackedStart.status).toBe(1);
    const taskBackedFailure = JSON.parse(taskBackedStart.stdout) as {
      readonly error: { readonly changeId: string };
    };
    expect(taskBackedFailure.error.changeId).toEqual(expect.any(String));
    const taskBackedPrepared = run(
      by,
      ["change", "prepare", taskBackedFailure.error.changeId, "--output", "json"],
      consumer,
    );
    expectSuccess(taskBackedPrepared);
    expect(JSON.parse(taskBackedPrepared.stdout)).toMatchObject({
      change: { id: taskBackedFailure.error.changeId, taskId, readiness: "ready" },
    });

    const cancelledTask = run(
      by,
      ["task", "cancel", taskId, "--reason", "No longer needed", "--output", "json"],
      consumer,
    );
    expectSuccess(cancelledTask);
    expect(JSON.parse(cancelledTask.stdout)).toMatchObject({
      task: { id: taskId, state: "cancelled" },
    });
  }, 120_000);
});
