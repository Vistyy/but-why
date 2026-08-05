import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, test } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";

const sourceNow = "2026-06-30T12:00:00.000Z";

const prepareSourceRepository = () => {
  const main = createTestWorkspace();
  const candidate = createTestWorkspace();
  cpSync(join(repoRoot, "bin"), join(main, "bin"), { recursive: true });
  cpSync(join(repoRoot, "src"), join(main, "src"), { recursive: true });
  cpSync(join(repoRoot, "package.json"), join(main, "package.json"));
  cpSync(join(repoRoot, "justfile"), join(main, "justfile"));
  symlinkSync(join(repoRoot, "node_modules"), join(main, "node_modules"), "dir");

  git(main, "init", "-q");
  git(main, "config", "user.name", "But Why Test");
  git(main, "config", "user.email", "but-why@example.test");
  git(main, "branch", "-M", "main");
  const initialized = runTestProcess("just", ["by", "init", "--task-prefix", "BY"], {
    cwd: main,
  });
  expect(initialized.status).toBe(0);
  git(main, "add", "bin", "src", "package.json", "justfile", ".but-why", ".gitignore");
  git(main, "commit", "-m", "source repository");
  git(main, "worktree", "add", "-b", "candidate", candidate, "main");
  symlinkSync(join(repoRoot, "node_modules"), join(candidate, "node_modules"), "dir");

  return { main, candidate };
};

test("source workflow delegates a Candidate worktree to the canonical executable", () => {
  const { main, candidate } = prepareSourceRepository();
  const candidateMigration = join(candidate, "src/sqlite/migrations/0009_candidate_probe.ts");
  writeFileSync(
    candidateMigration,
    `import * as SqlClient from "@effect/sql/SqlClient";\nimport { Effect } from "effect";\n\nexport const candidateProbeMigration = Effect.gen(function* () {\n  const sql = yield* SqlClient.SqlClient;\n  yield* sql.unsafe("CREATE TABLE candidate_migration_probe (id INTEGER PRIMARY KEY)");\n});\n`,
  );
  writeFileSync(
    join(candidate, "src/sqlite/repositoryMigrations.ts"),
    `${readFile(join(main, "src/sqlite/repositoryMigrations.ts"))
      .replace(
        'import { recoverPublishedRemoteBranchCleanupMigration as recoverPublishedRemoteBranchCleanup } from "./migrations/0008_recover_published_remote_branch_cleanup.js";\n',
        'import { recoverPublishedRemoteBranchCleanupMigration as recoverPublishedRemoteBranchCleanup } from "./migrations/0008_recover_published_remote_branch_cleanup.js";\nimport { candidateProbeMigration as candidateProbe } from "./migrations/0009_candidate_probe.js";\n',
      )
      .replace(
        '    "0008_recover_published_remote_branch_cleanup": recoverPublishedRemoteBranchCleanup,\n',
        '    "0008_recover_published_remote_branch_cleanup": recoverPublishedRemoteBranchCleanup,\n    "0009_candidate_probe": candidateProbe,\n',
      )}\n`,
  );
  writeFileSync(join(candidate, "description.md"), "Created by the trusted executable.\n");

  const result = runTestProcess(
    "just",
    ["by", "--json", "task", "create", "--title", "Trusted workflow", "--file", "description.md"],
    { cwd: candidate, env: { BUT_WHY_NOW: sourceNow } },
  );

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    task: { id: "BY-1", title: "Trusted workflow" },
  });
  expect(readMigrationIds(main)).toEqual([
    "baseline",
    "reviewer_sessions",
    "implementation_decisions",
    "implementation_blockers",
    "acceptance_context_versions",
    "reconcile_implementation_blocker_storage",
    "reviewer_sessions_per_producer",
    "recover_published_remote_branch_cleanup",
    "active_validation_runs",
    "validation_workspace_paths",
    "candidate_publications",
    "structured_implementation_decisions",
    "remove_no_change_completion",
    "remove_change_readiness",
    "remove_acceptance_context_versions",
    "remove_implementation_decision_content",
  ]);
  expect(readTableNames(main)).not.toContain("candidate_migration_probe");
}, 30_000);

test("source workflow fails without Candidate fallback when the main checkout is unavailable", () => {
  const { candidate } = prepareSourceRepository();
  const fakeGitDirectory = createTestWorkspace();
  const fakeGit = join(fakeGitDirectory, "git");
  const realGit = runTestProcessOrThrow("which", ["git"], { cwd: candidate });
  writeFileSync(
    fakeGit,
    `#!/bin/sh\nif [ "$1" = "worktree" ] && [ "$2" = "list" ]; then\n  exit 1\nfi\nexec ${realGit} "$@"\n`,
  );
  chmodSync(fakeGit, 0o755);

  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index-signature lookup.
  const inheritedPath = process.env["PATH"] ?? "";
  const result = runTestProcess("just", ["by", "--json", "task", "list"], {
    cwd: candidate,
    env: { PATH: `${fakeGitDirectory}:${inheritedPath}` },
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    error: {
      code: "main_checkout_unavailable",
      message: "The Local Repository's canonical main checkout is unavailable.",
    },
    help: ["Restore the canonical main checkout, then retry the command."],
  });

  const defaultResult = runTestProcess("just", ["by", "task", "list"], {
    cwd: candidate,
    env: { PATH: `${fakeGitDirectory}:${inheritedPath}` },
  });
  expect(defaultResult.status).toBe(1);
  expect(defaultResult.stderr).toBe("");
  expect(defaultResult.stdout).toBe(`error:
  code: main_checkout_unavailable
  message: "The Local Repository's canonical main checkout is unavailable."
help[1]: "Restore the canonical main checkout, then retry the command."
`);
}, 30_000);

test("source workflow preserves a newline in the canonical checkout path", () => {
  const { main, candidate } = prepareLauncherRepository();
  const trustedExecutable = join(main, "bin/by");
  rmSync(trustedExecutable);

  const result = runTestProcess("just", ["by", "--json", "task", "list"], {
    cwd: candidate,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    error: {
      code: "trusted_executable_unavailable",
      message: "The canonical main-checkout Trusted But Why Executable is unavailable.",
      path: trustedExecutable,
    },
    help: [
      "Restore the canonical main-checkout Trusted But Why Executable, then retry the command.",
    ],
  });
}, 30_000);

const prepareLauncherRepository = () => {
  const main = join(createTestWorkspace(), "main\ncheckout");
  const candidate = createTestWorkspace();
  mkdirSync(main);
  cpSync(join(repoRoot, "bin"), join(main, "bin"), { recursive: true });
  cpSync(join(repoRoot, "package.json"), join(main, "package.json"));
  cpSync(join(repoRoot, "justfile"), join(main, "justfile"));

  git(main, "init", "-q");
  git(main, "config", "user.name", "But Why Test");
  git(main, "config", "user.email", "but-why@example.test");
  git(main, "branch", "-M", "main");
  git(main, "add", "bin", "package.json", "justfile");
  git(main, "commit", "-m", "source launcher");
  git(main, "worktree", "add", "-b", "candidate", candidate, "main");

  return { main, candidate };
};

const readFile = (path: string): string => readFileSync(path, "utf8");

const readMigrationIds = (root: string): readonly string[] => {
  const database = new DatabaseSync(join(root, ".git/but-why/state.sqlite"));
  try {
    return database
      .prepare("SELECT name FROM effect_sql_migrations ORDER BY migration_id")
      .all()
      .map((row) => String((row as { readonly name: string }).name));
  } finally {
    database.close();
  }
};

const readTableNames = (root: string): readonly string[] => {
  const database = new DatabaseSync(join(root, ".git/but-why/state.sqlite"));
  try {
    return database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String((row as { readonly name: string }).name));
  } finally {
    database.close();
  }
};

const git = (cwd: string, ...args: readonly string[]): string =>
  runTestProcessOrThrow("git", args, { cwd });
