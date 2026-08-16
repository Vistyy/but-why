import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const sourceNow = "2026-06-30T12:00:00.000Z";

const prepareSourceRepository = () => {
  const main = createTestWorkspace();
  const candidate = createTestWorkspace();
  cpSync(join(repoRoot, "bin"), join(main, "bin"), { recursive: true });
  cpSync(join(repoRoot, "src"), join(main, "src"), { recursive: true });
  cpSync(join(repoRoot, "extensions"), join(main, "extensions"), { recursive: true });
  cpSync(join(repoRoot, "docs/public"), join(main, "docs/public"), { recursive: true });
  cpSync(join(repoRoot, "package.json"), join(main, "package.json"));
  cpSync(join(repoRoot, "justfile"), join(main, "justfile"));
  symlinkSync(join(repoRoot, "node_modules"), join(main, "node_modules"), "dir");

  git(main, "init", "-q");
  git(main, "config", "user.name", "But Why Test");
  git(main, "config", "user.email", "but-why@example.test");
  git(main, "branch", "-M", "main");
  const initialized = runTestProcess("just", ["by", "init", "--id-prefix", "BY"], {
    cwd: main,
  });
  expect(initialized.status).toBe(0);
  writeFileSync(
    join(main, ".but-why/config.json"),
    `${JSON.stringify({
      idPrefix: "BY",
      interactiveSession: { agentProfile: { scope: "repo", name: "implementation" } },
      agentProfiles: {
        implementation: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } },
      },
    })}\n`,
  );
  git(
    main,
    "add",
    "bin",
    "src",
    "extensions",
    "docs/public",
    "package.json",
    "justfile",
    ".but-why",
  );
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
  writeFileSync(join(candidate, "src/main.ts"), 'throw new Error("candidate_cli_probe_loaded");\n');
  writeFileSync(join(candidate, "description.md"), "Created by the trusted executable.\n");

  const result = runTestProcess(
    "just",
    ["by", "task", "create", "--title", "Trusted workflow", "--file", "description.md"],
    { cwd: candidate, env: { BUT_WHY_NOW: sourceNow } },
  );

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    task: { id: "BY-1", title: "Trusted workflow" },
  });
  expect(readMigrationIds(main)).not.toContain("candidate_probe");
  expect(readTableNames(main)).not.toContain("candidate_migration_probe");
}, 30_000);

test("source Change operations ignore a future Managed Worktree Repo Config", () => {
  const { main, candidate } = prepareSourceRepository();
  const changeId = "BY-C1";
  const head = git(candidate, "rev-parse", "HEAD");
  const database = new DatabaseSync(join(main, ".git/but-why/state.sqlite"));
  try {
    database
      .prepare(`
        INSERT INTO changes (
          id, repository_common_directory, branch_ref, base_ref, base_remote_url,
          starting_commit, worktree_path, acceptance_context,
          prepare_command, prepare_timeout_seconds, prepare_failure,
          state, close_reason, created_at, updated_at, closed_at, cleanup_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'open', NULL, ?, ?, NULL, 'complete')
      `)
      .run(
        1,
        join(main, ".git"),
        "refs/heads/candidate",
        "refs/remotes/origin/main",
        "https://github.com/acme/repo.git",
        head,
        candidate,
        sourceNow,
        sourceNow,
      );
  } finally {
    database.close();
  }
  writeFileSync(join(candidate, ".but-why/config.json"), `${JSON.stringify({ idPrefix: "BY" })}\n`);

  const tasks = runTestProcess("just", ["by", "task", "list"], { cwd: candidate });
  expect(tasks.status, `${tasks.stdout}${tasks.stderr}`).toBe(0);

  const shown = runTestProcess("just", ["by", "change", "show", changeId], { cwd: candidate });
  expect(shown.status, `${shown.stdout}${shown.stderr}`).toBe(0);
  expect(JSON.parse(shown.stdout)).toMatchObject({
    change: { id: changeId, worktreePath: candidate },
  });

  const inferred = runTestProcess("just", ["by", "change", "show"], { cwd: candidate });
  expect(inferred.status, `${inferred.stdout}${inferred.stderr}`).toBe(0);
  expect(JSON.parse(inferred.stdout)).toMatchObject({ change: { id: changeId } });

  const blockers = runTestProcess("just", ["by", "change", "blocker", "list", changeId], {
    cwd: candidate,
  });
  expect(blockers.status, `${blockers.stdout}${blockers.stderr}`).toBe(0);
  expect(JSON.parse(blockers.stdout)).toMatchObject({ changeId, blockers: [], active: null });

  const findings = runTestProcess("just", ["by", "change", "findings", changeId], {
    cwd: candidate,
  });
  expect(findings.status, `${findings.stdout}${findings.stderr}`).toBe(0);
  expect(JSON.parse(findings.stdout)).toMatchObject({
    change: { id: changeId },
    count: 0,
    findings: [],
  });

  const tools = createTestWorkspace();
  const herdr = join(tools, "herdr");
  writeFileSync(
    herdr,
    `#!/usr/bin/env sh
if [ "$1" = "agent" ] && [ "$2" = "list" ]; then
  printf '{"result":{"type":"agent_list","agents":[{"name":"${changeId}","cwd":"${candidate}","pane_id":"pane","agent_status":"working"}]}}\\n'
  exit 0
fi
exit 1
`,
  );
  chmodSync(herdr, 0o755);
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires an index-signature lookup.
  const inheritedPath = process.env["PATH"] ?? "";
  const implemented = runTestProcess("just", ["by", "change", "implement", changeId], {
    cwd: candidate,
    env: { PATH: `${tools}:${inheritedPath}` },
  });
  expect(implemented.status, `${implemented.stdout}${implemented.stderr}`).toBe(0);
  expect(JSON.parse(implemented.stdout)).toMatchObject({
    changeId,
    worktreePath: candidate,
    status: "already_active",
    agentProfile: "implementation",
    profileScope: "repo",
  });

  const submitted = runTestProcess("just", ["by", "change", "submit", changeId], {
    cwd: candidate,
  });
  expect(submitted.status).toBe(1);
  expect(JSON.parse(submitted.stdout)).toMatchObject({
    error: { code: "publication_remote_missing" },
  });
}, 30_000);

test("source workflow uses an integrity-checked predecessor only for exact reconciliation", () => {
  const { candidate } = prepareLauncherRepository();
  const bundle = createTestWorkspace();
  const executable = join(bundle, "pinned-by");
  writeFileSync(
    executable,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ args: process.argv.slice(2), executable: process.env.BUT_WHY_EXECUTABLE_PATH }) + "\\n");\n',
  );
  chmodSync(executable, 0o755);
  const manifest = join(bundle, "predecessor.json");
  writeFileSync(
    manifest,
    `${JSON.stringify({
      version: 1,
      changeId: "BY-1",
      commit: "0123456789abcdef0123456789abcdef01234567",
      sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
      executable: "pinned-by",
    })}\n`,
  );

  const reconciled = runTestProcess("just", ["by", "change", "reconcile", "BY-1"], {
    cwd: candidate,
    env: { BUT_WHY_PINNED_PREDECESSOR_MANIFEST: manifest },
  });
  expect(reconciled.status).toBe(0);
  expect(JSON.parse(reconciled.stdout)).toEqual({
    args: ["change", "reconcile", "BY-1"],
    executable,
  });

  const rejected = runTestProcess("just", ["by", "task", "list"], {
    cwd: candidate,
    env: { BUT_WHY_PINNED_PREDECESSOR_MANIFEST: manifest },
  });
  expect(rejected.status).toBe(1);
  expect(JSON.parse(rejected.stdout)).toMatchObject({
    error: { code: "pinned_predecessor_scope", changeId: "BY-1" },
    help: [
      "Run `by change reconcile BY-1` only after stopping the new executable and before opening Shared Repository State with it.",
    ],
  });

  const tamperedBundle = createTestWorkspace();
  mkdirSync(join(tamperedBundle, "src"));
  writeFileSync(
    join(tamperedBundle, "src", "main.ts"),
    'process.stdout.write(JSON.stringify({ source: "unhashed-source" }) + "\\n");\n',
  );
  const tamperedExecutable = join(tamperedBundle, "pinned-by");
  writeFileSync(
    tamperedExecutable,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ source: "hashed-executable" }) + "\\n");\n',
  );
  chmodSync(tamperedExecutable, 0o755);
  const tamperedManifest = join(bundle, "tampered-predecessor.json");
  writeFileSync(
    tamperedManifest,
    `${JSON.stringify({
      version: 1,
      changeId: "BY-1",
      commit: "0123456789abcdef0123456789abcdef01234567",
      sha256: createHash("sha256").update(readFileSync(tamperedExecutable)).digest("hex"),
      executable: tamperedExecutable,
    })}\n`,
  );
  const tamperedReconciled = runTestProcess("just", ["by", "change", "reconcile", "BY-1"], {
    cwd: candidate,
    env: { BUT_WHY_PINNED_PREDECESSOR_MANIFEST: tamperedManifest },
  });
  expect(tamperedReconciled.status).toBe(1);
  expect(JSON.parse(tamperedReconciled.stdout)).toMatchObject({
    error: { code: "pinned_predecessor_manifest_invalid" },
  });

  const escapingManifest = join(bundle, "escaping-predecessor.json");
  writeFileSync(
    escapingManifest,
    `${JSON.stringify({
      version: 1,
      changeId: "BY-1",
      commit: "0123456789abcdef0123456789abcdef01234567",
      sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
      executable: "../outside/pinned-by",
    })}\n`,
  );
  const escaping = runTestProcess("just", ["by", "change", "reconcile", "BY-1"], {
    cwd: candidate,
    env: { BUT_WHY_PINNED_PREDECESSOR_MANIFEST: escapingManifest },
  });
  expect(escaping.status).toBe(1);
  expect(JSON.parse(escaping.stdout)).toMatchObject({
    error: { code: "pinned_predecessor_manifest_invalid" },
  });

  const linkedExecutable = join(bundle, "linked-by");
  symlinkSync(tamperedExecutable, linkedExecutable);
  const symlinkManifest = join(bundle, "symlink-predecessor.json");
  writeFileSync(
    symlinkManifest,
    `${JSON.stringify({
      version: 1,
      changeId: "BY-1",
      commit: "0123456789abcdef0123456789abcdef01234567",
      sha256: createHash("sha256").update(readFileSync(tamperedExecutable)).digest("hex"),
      executable: "linked-by",
    })}\n`,
  );
  const symlinked = runTestProcess("just", ["by", "change", "reconcile", "BY-1"], {
    cwd: candidate,
    env: { BUT_WHY_PINNED_PREDECESSOR_MANIFEST: symlinkManifest },
  });
  expect(symlinked.status).toBe(1);
  expect(JSON.parse(symlinked.stdout)).toMatchObject({
    error: { code: "pinned_predecessor_manifest_invalid" },
  });
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
  const result = runTestProcess("just", ["by", "task", "list"], {
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
}, 30_000);

test("source workflow preserves a newline in the canonical checkout path", () => {
  const { main, candidate } = prepareLauncherRepository();
  const trustedExecutable = join(main, "bin/by");
  rmSync(trustedExecutable);

  const result = runTestProcess("just", ["by", "task", "list"], {
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
