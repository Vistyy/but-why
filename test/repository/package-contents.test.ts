import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect } from "vitest";

import {
  RepositorySql,
  repositorySqlLayer,
} from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import { commitButWhyConfigAndRecordDefault, createGitRepo, repoRoot } from "../support/by-cli.js";
import { createChangeImplementFixture } from "../support/changeImplementFixture.js";
import { startFakeHerdrApiServer } from "../support/fakeHerdrApiServer.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const packageProcessTimeoutMs = 30_000;
const expectedLazyCommandModules = [
  "./cli/task/commands/dependencies.js",
  "./cli/task/commands/contextDraft.js",
  "./cli/task/commands/contextApply.js",
  "./cli/task/commands/context.js",
  "./cli/task/commands/create.js",
  "./cli/task/commands/list.js",
  "./cli/task/commands/rename.js",
  "./cli/task/commands/show.js",
  "./cli/task/commands/revise.js",
  "./cli/task/commands/submit.js",
  "./cli/task/commands/review.js",
  "./cli/task/commands/cancel.js",
  "./cli/change/decision.js",
  "./cli/change/blocker.js",
  "./cli/change/start.js",
  "./cli/change/prepare.js",
  "./cli/change/list.js",
  "./cli/change/show.js",
  "./cli/change/findings.js",
  "./cli/change/validationRuns.js",
  "./cli/change/submit.js",
  "./cli/change/cancel.js",
  "./cli/change/reconcile.js",
  "./cli/change/implement.js",
  "./cli/validationRun/show.js",
  "./cli/validationRun/abandon.js",
  "./cli/validationRun/artifact.js",
  "./cli/initCli.js",
  "./cli/task/dashboard.js",
] as const;

type PackedPackageMetadata = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly files: readonly { readonly path: string }[];
};

type PackageManifest = {
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
  readonly keywords: readonly string[];
  readonly pi: { readonly skills: readonly string[] };
  readonly bin: { readonly by: string };
  readonly files: readonly string[];
  readonly repository: { readonly type: string; readonly url: string };
};

type PreparedPackage = {
  readonly root: string;
  readonly installedRoot: string;
  readonly installedPackage: string;
  readonly metadata: PackedPackageMetadata;
  readonly manifest: PackageManifest;
};

const decodeSourceMapSources = (source: string): readonly string[] => {
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Generated source map must be an object");
  }
  const sources = Reflect.get(parsed, "sources");
  if (!Array.isArray(sources) || !sources.every((entry) => typeof entry === "string")) {
    throw new Error("Generated source map must contain string sources");
  }
  return sources;
};

const createPackageFixture = (packageRoot: string): void => {
  cpSync(join(repoRoot, "package.json"), join(packageRoot, "package.json"));
  cpSync(join(repoRoot, "README.md"), join(packageRoot, "README.md"));
  cpSync(join(repoRoot, "CHANGELOG.md"), join(packageRoot, "CHANGELOG.md"));
  mkdirSync(join(packageRoot, "scripts"));
  cpSync(join(repoRoot, "scripts", "build.mjs"), join(packageRoot, "scripts", "build.mjs"));
  cpSync(join(repoRoot, "extensions"), join(packageRoot, "extensions"), { recursive: true });
  mkdirSync(join(packageRoot, "docs"));
  cpSync(join(repoRoot, "docs", "public"), join(packageRoot, "docs", "public"), {
    recursive: true,
  });
};

describe("release package boundary", () => {
  let fixtureRoot: string | undefined;
  let prepared: PreparedPackage;

  beforeAll(() => {
    const root = acquireTestWorkspace();
    fixtureRoot = root;
    createPackageFixture(root);
    cpSync(join(repoRoot, "src"), join(root, "src"), { recursive: true });
    cpSync(join(repoRoot, "tsconfig.json"), join(root, "tsconfig.json"));
    cpSync(join(repoRoot, "tsconfig.build.json"), join(root, "tsconfig.build.json"));
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, "test", "package-sentinel.test.ts"), "export {};\n");
    writeFileSync(join(root, "justfile"), "default:\n");
    symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));

    const build = runTestProcess("pnpm", ["run", "build"], {
      cwd: root,
      timeout: packageProcessTimeoutMs,
    });
    expect(build.error).toBeUndefined();
    expect(build.status, build.stderr || build.stdout).toBe(0);
    const pack = runTestProcess("npm", ["pack", "--ignore-scripts", "--json"], {
      cwd: root,
      timeout: packageProcessTimeoutMs,
    });
    expect(pack.error).toBeUndefined();
    expect(pack.status, pack.stderr || pack.stdout).toBe(0);
    const [metadata] = JSON.parse(pack.stdout) as readonly (PackedPackageMetadata & {
      readonly filename: string;
    })[];
    if (metadata === undefined) throw new Error("npm pack did not return a package");

    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    const installedRoot = join(root, "installed");
    const install = runTestProcess(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installedRoot,
        join(root, metadata.filename),
      ],
      { cwd: root, timeout: packageProcessTimeoutMs },
    );
    expect(install.status, install.stderr || install.stdout).toBe(0);
    prepared = {
      root,
      installedRoot,
      installedPackage: join(installedRoot, "node_modules", "but-why"),
      metadata,
      manifest: JSON.parse(
        readFileSync(join(installedRoot, "node_modules", "but-why", "package.json"), "utf8"),
      ) as PackageManifest,
    };
  }, 120_000);

  afterAll(() => {
    if (fixtureRoot !== undefined) releaseTestWorkspace(fixtureRoot);
  });

  it("contains only supported package content and required metadata", () => {
    const { manifest, metadata: packedPackage, root } = prepared;
    const files = packedPackage.files.map((file) => file.path).sort();

    expect(manifest).toMatchObject({
      name: "but-why",
      version: "0.0.1",
      private: false,
      keywords: ["pi-package"],
      pi: { skills: ["./docs/public/skills"] },
      bin: { by: "./dist/main.js" },
      files: ["dist", "extensions", "docs/public", "README.md", "CHANGELOG.md"],
      repository: { type: "git", url: "git+https://github.com/Vistyy/but-why.git" },
    });
    expect(packedPackage).toMatchObject({
      id: "but-why@0.0.1",
      name: "but-why",
      version: "0.0.1",
    });
    expect(
      files.every(
        (path) =>
          path === "package.json" ||
          path === "README.md" ||
          path === "CHANGELOG.md" ||
          path.startsWith("dist/") ||
          path.startsWith("extensions/") ||
          path.startsWith("docs/public/"),
      ),
    ).toBe(true);
    for (const required of [
      "dist/main.js",
      "package.json",
      "README.md",
      "CHANGELOG.md",
      "docs/public/config.md",
      "docs/public/setup.md",
      "extensions/continue-change.ts",
      "docs/public/skills/but-why/SKILL.md",
      "docs/public/skills/but-why/references/command-guidance.md",
      "docs/public/skills/but-why/references/implement-change.md",
      "docs/public/skills/but-why/references/operator-workflow.md",
      "docs/public/skills/but-why/references/task-authoring.md",
      "docs/public/skills/but-why/references/task-verification.md",
    ]) {
      expect(files).toContain(required);
    }
    for (const excluded of ["src/", "test/", "spikes/", "skills/"]) {
      expect(files.some((path) => path.startsWith(excluded))).toBe(false);
    }
    expect(
      files.every((path) => !path.startsWith("docs/") || path.startsWith("docs/public/")),
    ).toBe(true);
    expect(files).not.toContain("bin/by");
    expect(files).not.toContain("justfile");
    expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toContain("Source tag: `v0.0.1`");
  });

  it("preserves lazy command loading and includes every declared dynamic target", () => {
    const entry = join(prepared.root, "dist/main.js");
    const entrySource = readFileSync(entry, "utf8");
    const staticEntryFiles = new Set<string>();
    const staticEntryQueue = [entry];
    while (staticEntryQueue.length > 0) {
      const current = staticEntryQueue.pop();
      if (current === undefined || staticEntryFiles.has(current)) continue;
      staticEntryFiles.add(current);
      const source = readFileSync(current, "utf8");
      for (const match of source.matchAll(/(?:from|import)["'](\.\.?(?:\/)[^"']+)["']/g)) {
        const target = match[1];
        if (target !== undefined) staticEntryQueue.push(join(dirname(current), target));
      }
    }
    const declaredSource = readFileSync(join(prepared.root, "src/cliCommandTree.ts"), "utf8");
    const declaredTargets = [...declaredSource.matchAll(/import\("(\.\/cli\/[^"?]+)"\)/g)].flatMap(
      ([, target]) => (target === undefined ? [] : [target]),
    );
    expect([...new Set(declaredTargets)].sort()).toEqual([...expectedLazyCommandModules].sort());

    const dynamicTargets = [...entrySource.matchAll(/import\([`"](\.\/[^`"]+)[`"]\)/g)].flatMap(
      ([, target]) => (target === undefined ? [] : [target]),
    );
    expect(dynamicTargets).toHaveLength(declaredTargets.length);
    const uniqueDynamicTargets = [...new Set(dynamicTargets)];
    const dynamicTargetFiles = new Set(
      uniqueDynamicTargets.map((target) => join(prepared.root, "dist", target.slice(2))),
    );
    expect([...staticEntryFiles].every((file) => !dynamicTargetFiles.has(file))).toBe(true);
    const targetSources = new Map(
      uniqueDynamicTargets.map((target) => [
        target,
        decodeSourceMapSources(
          readFileSync(join(prepared.root, "dist", `${target.slice(2)}.map`), "utf8"),
        ),
      ]),
    );
    const owningTargets = expectedLazyCommandModules.map((module) => {
      const expectedSource = `../src/${module.slice(2, -3)}.ts`;
      const owners = uniqueDynamicTargets.filter((target) =>
        targetSources.get(target)?.includes(expectedSource),
      );
      expect(owners).toHaveLength(1);
      return owners[0];
    });
    expect(new Set(owningTargets).size).toBe(expectedLazyCommandModules.length);

    const packedFiles = new Set(prepared.metadata.files.map((file) => file.path));
    expect(
      dynamicTargets.every(
        (target) =>
          existsSync(join(prepared.root, "dist", target.slice(2))) &&
          packedFiles.has(`dist/${target.slice(2)}`),
      ),
    ).toBe(true);
  });

  it("preserves missing dependency-option guidance through the installed executable", () => {
    const repositoryRoot = createGitRepo();
    const bin = join(prepared.installedRoot, "node_modules", ".bin", "by");

    for (const operation of ["add", "remove", "replace"] as const) {
      const result = runTestProcess(
        bin,
        ["--log-level", "info", "task", "dependencies", operation, "BY-1"],
        { cwd: repositoryRoot, timeout: packageProcessTimeoutMs },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error:
          operation === "replace"
            ? {
                code: "replace_requires_dependency",
                message: "The replace operation requires at least one prerequisite.",
              }
            : {
                code: "depends_on_required",
                message: `The ${operation} operation requires at least one --depends-on value.`,
              },
        help:
          operation === "replace"
            ? ["Use `by task dependencies clear <task-id>` to remove all prerequisites."]
            : [`Use \`by task dependencies ${operation} <task-id> --depends-on <task-id>\`.`],
      });
    }
  });

  it.effect("initializes the release baseline through the installed executable", () => {
    const repositoryRoot = createGitRepo();
    const bin = join(prepared.installedRoot, "node_modules", ".bin", "by");
    const initialized = runTestProcess(bin, ["init", "--id-prefix", "BY"], {
      cwd: repositoryRoot,
      timeout: packageProcessTimeoutMs,
    });
    expect(initialized.status, initialized.stderr || initialized.stdout).toBe(0);
    expect(JSON.parse(initialized.stdout)).toMatchObject({ init: { status: "initialized" } });

    const listed = runTestProcess(bin, ["task", "list"], {
      cwd: repositoryRoot,
      timeout: packageProcessTimeoutMs,
    });
    expect(listed.status, listed.stderr || listed.stdout).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({ tasks: [] });

    return Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* RepositorySql;
        const migrations = yield* repository.operation(
          "inspect installed migration ledger",
          (sql) =>
            sql<{ readonly migrationId: number }>`
            SELECT migration_id AS migrationId
            FROM effect_sql_migrations
            ORDER BY migration_id
          `,
        );
        expect(migrations).toEqual([{ migrationId: 1 }, { migrationId: 2 }, { migrationId: 3 }]);

        const tables = yield* repository.operation(
          "inspect installed product tables",
          (sql) =>
            sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
              AND name NOT LIKE 'effect_sql_%'
            ORDER BY name
          `,
        );
        expect(tables).toHaveLength(23);
        expect(tables.map(({ name }) => name)).toContain("shared_state_identity");
        expect(tables.map(({ name }) => name)).toContain("validation_runs");
      }).pipe(
        Effect.provide(
          repositorySqlLayer({
            commonDirectory: join(repositoryRoot, ".git"),
            statePath: join(repositoryRoot, ".git", "but-why", "state.sqlite"),
            lifecycle: "open",
          }),
        ),
      ),
    );
  });

  it("uses a linked invoking worktree through the installed executable", () => {
    const repositoryRoot = createGitRepo();
    const bin = join(prepared.installedRoot, "node_modules", ".bin", "by");
    const initialized = runTestProcess(bin, ["init", "--id-prefix", "BY"], {
      cwd: repositoryRoot,
      timeout: packageProcessTimeoutMs,
    });
    expect(initialized.status, initialized.stderr || initialized.stdout).toBe(0);
    commitButWhyConfigAndRecordDefault(repositoryRoot);

    const linkedWorktree = join(
      dirname(repositoryRoot),
      `${basename(repositoryRoot)}-installed-linked-caller`,
    );
    runTestProcessOrThrow(
      "git",
      ["worktree", "add", "-b", "installed-linked-caller", linkedWorktree, "main"],
      { cwd: repositoryRoot },
    );
    const started = runTestProcess(bin, ["change", "start"], {
      cwd: linkedWorktree,
      timeout: packageProcessTimeoutMs,
    });

    expect(started.status, started.stderr || started.stdout).toBe(0);
    const result = JSON.parse(started.stdout) as { readonly worktreePath: string };
    expect(dirname(dirname(result.worktreePath))).toBe(
      join(dirname(linkedWorktree), `${basename(linkedWorktree)}-worktrees`),
    );
  });

  it.effect(
    "loads installed continuation assets and reports invalid or missing extensions truthfully",
    () =>
      Effect.gen(function* () {
        const { installedPackage, installedRoot: installed } = prepared;
        expect(
          readFileSync(join(installedPackage, "extensions/continue-change.ts"), "utf8"),
        ).toContain("continue-change");
        const repository = createGitRepo();
        mkdirSync(join(repository, ".git", "but-why"), { recursive: true });
        mkdirSync(join(repository, ".but-why"));
        writeFileSync(join(repository, ".but-why", "config.json"), '{"idPrefix":"BY"}\n');
        const change = yield* createChangeImplementFixture(repository, {
          managedRepoConfig: {
            idPrefix: "BY",
            agentEnvironment: { command: ["nix", "develop", "-c"] },
          },
        });
        const tools = createTestWorkspace();
        writeFileSync(
          join(tools, "gh"),
          '#!/usr/bin/env sh\nif [ "$1" = "repo" ] && [ "$2" = "view" ]; then printf \'{\\"defaultBranchRef\\":{\\"name\\":\\"main\\"}}\\n\'; exit 0; fi\nexit 1\n',
        );
        writeFileSync(
          join(tools, "herdr"),
          `#!/usr/bin/env sh
if [ "$1" = "agent" ] && [ "$2" = "list" ]; then
  if [ -f "$BY_FAKE_CAPTURE.started" ]; then
    printf '{"result":{"type":"agent_list","agents":[{"name":"%s","cwd":"%s","pane_id":"pane","agent_status":"working"}]}}\\n' "$BY_FAKE_SESSION" "$BY_FAKE_WORKTREE"
  else
    printf '{"result":{"type":"agent_list","agents":[]}}\\n'
  fi
  exit 0
fi
if [ "$1" = "workspace" ] && [ "$2" = "list" ]; then
  printf '{"result":{"type":"workspace_list","workspaces":[]}}\\n'
  exit 0
fi
if [ "$1" = "workspace" ] && [ "$2" = "create" ]; then
  printf '{"result":{"type":"workspace_created","workspace":{"workspace_id":"workspace"},"tab":{"tab_id":"tab","workspace_id":"workspace"},"root_pane":{"pane_id":"pane","workspace_id":"workspace","tab_id":"tab","cwd":"%s"}}}\\n' "$BY_FAKE_WORKTREE"
  exit 0
fi
if [ "$1" = "agent" ] && [ "$2" = "start" ]; then
  printf '%s\\n' "$@" > "$BY_FAKE_CAPTURE.args"
  : > "$BY_FAKE_CAPTURE.started"
  printf '{"result":{"type":"agent_started","agent":{"terminal_id":"terminal"}}}\\n'
  exit 0
fi
exit 1
`,
        );
        chmodSync(join(tools, "gh"), 0o755);
        chmodSync(join(tools, "herdr"), 0o755);
        const bin = join(installed, "node_modules", ".bin", "by");
        const socketPath = join(tools, "herdr.sock");
        const env = {
          // biome-ignore lint/complexity/useLiteralKeys: Node's environment type requires indexed access.
          PATH: `${tools}:${process.env["PATH"] ?? ""}`,
          BY_FAKE_CAPTURE: join(repository, "herdr-capture.txt"),
          HERDR_SOCKET_PATH: socketPath,
        };
        const isolatedHome = createTestWorkspace();
        mkdirSync(join(isolatedHome, ".config", "but-why"), { recursive: true });
        writeFileSync(
          join(isolatedHome, ".config", "but-why", "config.json"),
          `${JSON.stringify({
            defaultAgentProfile: { scope: "global", name: "test" },
            agentProfiles: { test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } } },
          })}\n`,
        );
        const implement = yield* Effect.acquireUseRelease(
          Effect.promise(() =>
            startFakeHerdrApiServer({
              socketPath,
              capturePath: env.BY_FAKE_CAPTURE,
              readyPath: join(tools, "herdr-api-ready"),
            }),
          ),
          () =>
            Effect.sync(() =>
              runTestProcess(bin, ["change", "implement", change.id], {
                cwd: repository,
                env: {
                  ...env,
                  BY_FAKE_WORKTREE: change.worktreePath,
                  BY_FAKE_SESSION: change.id,
                },
                isolatedHome,
                timeout: packageProcessTimeoutMs,
              }),
            ),
          (server) => Effect.promise(server.stop),
        );
        expect(implement.status, `${implement.stdout}${implement.stderr}`).toBe(0);
        const startArgs = readFileSync(`${env.BY_FAKE_CAPTURE}.args`, "utf8");
        const extension = join(installedPackage, "extensions/continue-change.ts");
        const commandGuidance = join(
          installedPackage,
          "docs/public/skills/but-why/references/command-guidance.md",
        );
        const implementationInstructions = join(
          installedPackage,
          "docs/public/skills/but-why/references/implement-change.md",
        );
        expect(startArgs).toContain(extension);
        expect(startArgs).toContain(commandGuidance);
        expect(startArgs).toContain(implementationInstructions);
        expect(readFileSync(env.BY_FAKE_CAPTURE, "utf8")).toContain("Change identity:");

        writeFileSync(extension, "export default 42;\n");
        rmSync(env.BY_FAKE_CAPTURE);
        const invalidExtension = runTestProcess(bin, ["change", "implement", change.id], {
          cwd: repository,
          env: {
            ...env,
            BY_FAKE_WORKTREE: change.worktreePath,
            BY_FAKE_SESSION: change.id,
          },
          isolatedHome,
          timeout: packageProcessTimeoutMs,
        });
        expect(invalidExtension.status).toBe(1);
        expect(JSON.parse(invalidExtension.stdout)).toMatchObject({
          error: {
            code: "launch_failed",
            message: expect.stringContaining(
              "Required trusted continuation extension failed preflight",
            ),
          },
        });
        expect(existsSync(env.BY_FAKE_CAPTURE)).toBe(false);

        rmSync(extension);
        const missingExtension = runTestProcess(bin, ["change", "implement", change.id], {
          cwd: repository,
          env: {
            ...env,
            BY_FAKE_WORKTREE: change.worktreePath,
            BY_FAKE_SESSION: change.id,
          },
          isolatedHome,
          timeout: packageProcessTimeoutMs,
        });
        expect(missingExtension.status).toBe(1);
        expect(JSON.parse(missingExtension.stdout)).toMatchObject({
          error: {
            code: "launch_failed",
            message: expect.stringContaining("Required trusted continuation extension is missing"),
          },
        });
        expect(existsSync(env.BY_FAKE_CAPTURE)).toBe(false);
      }),
    120_000,
  );
});
