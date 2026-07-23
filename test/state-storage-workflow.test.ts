import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  runBuiltByWithEnv,
} from "./support/by-cli.js";
import { createTestWorkspace } from "./support/testWorkspace.js";

const now = "2026-07-25T10:00:00.000Z";
const processEnvironment: NodeJS.ProcessEnv = { BUT_WHY_NOW: now };

it("persists a Task-backed Change through cross-process initialization, inspection, and validation", () => {
  const root = createGitRepo();
  const home = createTestWorkspace();
  const globalConfigDirectory = join(home, ".config/but-why");
  mkdirSync(globalConfigDirectory, { recursive: true });
  writeFileSync(
    join(globalConfigDirectory, "config.json"),
    `${JSON.stringify({
      defaultAgentProfile: "test",
      agentProfiles: { test: { agentRuntime: "pi", agentModel: "test/model" } },
    })}\n`,
  );
  // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
  processEnvironment["HOME"] = home;
  expect(run(root, "init", "--task-prefix", "BY").status).toBe(0);
  writeFileSync(
    join(root, ".but-why/config.json"),
    `${JSON.stringify({
      taskPrefix: "BY",
      validation: { checks: [{ id: "quality", command: "false" }] },
    })}\n`,
  );
  commitButWhyConfigAndRecordDefault(root);
  git(root, "remote", "set-url", "origin", "https://github.com/acme/repo.git");
  const tools = createTestWorkspace();
  writeFileSync(
    join(tools, "gh"),
    `#!/usr/bin/env sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '{"defaultBranchRef":{"name":"main"}}\\n'
  exit 0
fi
if [ "$1" = "api" ]; then
  printf '[]\\n'
  exit 0
fi
exit 1
`,
  );
  chmodSync(join(tools, "gh"), 0o755);
  // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
  processEnvironment["PATH"] = `${tools}:${process.env["PATH"] ?? ""}`;

  writeFileSync(join(root, "task.md"), "Validate this Task-backed Change.");
  const created = run(
    root,
    "task",
    "create",
    "--title",
    "Cross-process storage",
    "--description-file",
    "task.md",
    "--output",
    "json",
  );
  expect(created.status).toBe(0);
  const taskId = (JSON.parse(created.stdout) as { readonly task: { readonly id: string } }).task.id;
  expect(run(root, "task", "approve", taskId).status).toBe(0);

  const started = run(root, "change", "start", "--task", taskId, "--output", "json");
  expect(started.status).toBe(0);
  const change = JSON.parse(started.stdout) as {
    readonly change: { readonly id: string };
    readonly worktreePath: string;
  };
  writeFileSync(join(change.worktreePath, "changed.txt"), "changed\n");
  git(change.worktreePath, "add", "changed.txt");
  git(
    change.worktreePath,
    "-c",
    "user.name=But Why Test",
    "-c",
    "user.email=but-why@example.test",
    "commit",
    "-m",
    "Add validated change",
  );

  const inspected = run(root, "change", "show", change.change.id, "--output", "json");
  expect(inspected.status).toBe(0);
  expect(JSON.parse(inspected.stdout)).toMatchObject({
    change: { id: change.change.id, taskId, state: "open" },
  });

  const submitted = run(root, "change", "submit", change.change.id, "--output", "json");
  expect(submitted.status).toBe(1);
  expect(JSON.parse(submitted.stdout)).toMatchObject({
    error: { code: "validation_findings", changeId: change.change.id },
  });

  const history = run(root, "change", "validation-runs", change.change.id, "--output", "json");
  expect(history.status).toBe(0);
  expect(JSON.parse(history.stdout)).toMatchObject({
    validationRuns: [{ outcome: "blocked" }],
  });
}, 30_000);

const run = (cwd: string, ...args: readonly string[]) =>
  runBuiltByWithEnv(cwd, processEnvironment, ...args);

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
