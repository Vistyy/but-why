import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  }, 120_000);
});
