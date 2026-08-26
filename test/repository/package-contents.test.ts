import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect } from "vitest";

import { commitButWhyConfigAndRecordDefault, createGitRepo, repoRoot } from "../support/by-cli.js";
import { createChangeImplementFixture } from "../support/changeImplementFixture.js";
import { startFakeHerdrApiServer } from "../support/fakeHerdrApiServer.js";
import { runTestProcess, runTestProcessOrThrow, startTestProcess } from "../support/testProcess.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const packageProcessTimeoutMs = 30_000;
const packageBaselineTestTimeoutMs = 70_000;
const packageLinkedWorktreeTestTimeoutMs = 75_000;
// biome-ignore lint/complexity/useLiteralKeys: Node's environment type requires indexed access.
const realHerdrEnabled = process.env["BY_RUN_REAL_HERDR_INTEGRATION"] === "1";
const realHerdrProcessTimeoutMs = 180_000;
const realHerdrTestTimeoutMs = 1_800_000;

type PackedPackageMetadata = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly filename: string;
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

type PiProbe = {
  readonly prompt: string;
  readonly commands: readonly string[];
};

type HerdrWorkspace = Readonly<Record<string, unknown>> & { readonly workspace_id: unknown };

const executeRealHerdrCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
  isolatedHome: string,
  socketPath: string,
): string => {
  const result = runTestProcess(command, args, {
    cwd,
    isolatedHome,
    env: { HERDR_SOCKET_PATH: socketPath },
    timeout: realHerdrProcessTimeoutMs,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return result.stdout;
};

const listHerdrWorkspaces = (
  cwd: string,
  isolatedHome: string,
  socketPath: string,
): readonly HerdrWorkspace[] => {
  const response = JSON.parse(
    executeRealHerdrCommand("herdr", ["workspace", "list"], cwd, isolatedHome, socketPath),
  ) as { readonly result?: { readonly type?: string; readonly workspaces?: unknown } };
  if (response.result?.type !== "workspace_list" || !Array.isArray(response.result.workspaces)) {
    throw new Error("Herdr returned malformed workspace-list output.");
  }
  return response.result.workspaces as readonly HerdrWorkspace[];
};

const waitForHerdr = (cwd: string, isolatedHome: string, socketPath: string): void => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = runTestProcess("herdr", ["status", "server"], {
      cwd,
      isolatedHome,
      env: { HERDR_SOCKET_PATH: socketPath },
      timeout: 1_000,
    });
    if (result.status === 0 && result.stdout.includes("status: running")) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`Dedicated Herdr server did not become ready at ${socketPath}.`);
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

const generatedModuleTargets = (source: string): readonly string[] =>
  [...source.matchAll(/import\s*\(\s*[`"'](\.\/[^`"']+)[`"']\s*\)/g)].flatMap(([, target]) =>
    target === undefined ? [] : [target],
  );

const staticallyReachableModules = (entry: string): ReadonlySet<string> => {
  const files = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || files.has(current)) continue;
    files.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(/(?:from|import)\s*["'](\.\.?\/[^"']+)["']/g)) {
      const target = match[1];
      if (target !== undefined) queue.push(join(dirname(current), target));
    }
  }
  return files;
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
    const [metadata] = JSON.parse(pack.stdout) as readonly PackedPackageMetadata[];
    if (metadata === undefined) throw new Error("npm pack did not return a package");

    rmSync(join(root, "node_modules"), { recursive: true, force: true });
    const installedRoot = join(root, "installed");
    const tarball = join(root, metadata.filename);
    const install = runTestProcess(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installedRoot,
        tarball,
      ],
      { cwd: root, timeout: packageProcessTimeoutMs },
    );
    expect(install.status, install.stderr || install.stdout).toBe(0);
    const installedPackage = join(installedRoot, "node_modules", "but-why");
    prepared = {
      root,
      installedRoot,
      installedPackage,
      metadata,
      manifest: JSON.parse(
        readFileSync(join(installedPackage, "package.json"), "utf8"),
      ) as PackageManifest,
    };
  }, 120_000);

  afterAll(() => {
    if (fixtureRoot !== undefined) releaseTestWorkspace(fixtureRoot);
  });

  it("contains the supported package surface and required metadata", () => {
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
    for (const required of [
      "dist/main.js",
      "package.json",
      "extensions/continue-change.ts",
      "docs/public/skills/but-why/SKILL.md",
      "docs/public/skills/but-why/references/command-guidance.md",
      "docs/public/skills/but-why/references/implement-change.md",
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

  it("keeps generated command chunks lazy and includes them in the package", () => {
    const entry = join(prepared.root, "dist/main.js");
    const dynamicTargets = generatedModuleTargets(readFileSync(entry, "utf8"));
    expect(dynamicTargets.length).toBeGreaterThan(0);

    const dynamicFiles = new Set(
      dynamicTargets.map((target) => join(prepared.root, "dist", target.slice(2))),
    );
    const packedFiles = new Set(prepared.metadata.files.map((file) => file.path));
    for (const target of dynamicTargets) {
      expect(existsSync(join(prepared.root, "dist", target.slice(2)))).toBe(true);
      expect(packedFiles.has(`dist/${target.slice(2)}`)).toBe(true);
    }
    expect([...staticallyReachableModules(entry)].every((file) => !dynamicFiles.has(file))).toBe(
      true,
    );
  });

  it("resolves Pi OAuth through the installed runtime dependency", () => {
    const bundledSources = prepared.metadata.files.flatMap(({ path }) =>
      path.startsWith("dist/") && path.endsWith(".js")
        ? [readFileSync(join(prepared.installedPackage, path), "utf8")]
        : [],
    );
    expect(
      bundledSources.some((source) =>
        /(?:from|import)\s*(?:\(\s*)?["']@earendil-works\/pi-coding-agent["']/.test(source),
      ),
    ).toBe(true);

    const authFixture = createTestWorkspace();
    const authPath = join(authFixture, "auth.json");
    writeFileSync(
      authPath,
      `${JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "installed-package-access-token",
          refresh: "unused-refresh-token",
          expires: Date.now() + 60 * 60 * 1_000,
        },
      })}\n`,
    );
    const sentinel = join(prepared.installedRoot, "pi-oauth-sentinel.mjs");
    writeFileSync(
      sentinel,
      `import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const runtime = await ModelRuntime.create({
  authPath: process.argv[2],
  modelsPath: null,
  refreshOnCreate: false,
});
console.log(JSON.stringify(await runtime.getAuth("openai-codex")));
`,
    );

    const resolved = runTestProcess(process.execPath, [sentinel, authPath], {
      cwd: prepared.installedRoot,
      timeout: packageProcessTimeoutMs,
    });
    expect(resolved.error).toBeUndefined();
    expect(resolved.status, resolved.stderr || resolved.stdout).toBe(0);
    expect(JSON.parse(resolved.stdout)).toEqual({
      auth: { apiKey: "installed-package-access-token" },
      source: "OAuth",
    });
  });

  it(
    "initializes and reads an empty repository through the installed executable",
    () => {
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
    },
    packageBaselineTestTimeoutMs,
  );

  it(
    "uses a linked invoking worktree through the installed executable",
    () => {
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
    },
    packageLinkedWorktreeTestTimeoutMs,
  );

  it("exposes the packaged skill to Pi", () => {
    const consumer = createTestWorkspace();
    const agentDirectory = join(createTestWorkspace(), "agent");
    const probeOutput = join(consumer, "probe.json");
    const probeExtension = join(consumer, "probe.mjs");
    writeFileSync(
      probeExtension,
      [
        'import { writeFileSync } from "node:fs";',
        "export default function probe(pi) {",
        '  pi.registerCommand("probe", { description: "Probe skill discovery", handler: async (_args, ctx) => {',
        "    writeFileSync(process.env.PROBE_OUTPUT, JSON.stringify({ prompt: ctx.getSystemPrompt(), commands: pi.getCommands().map((command) => command.name) }));",
        "  } });",
        "}",
        "",
      ].join("\n"),
    );
    const pi = join(repoRoot, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    const environment = { PI_CODING_AGENT_DIR: agentDirectory, PI_OFFLINE: "1" };
    const install = runTestProcess(process.execPath, [pi, "install", prepared.installedPackage], {
      cwd: consumer,
      env: environment,
      isolatedHome: createTestWorkspace(),
      timeout: packageProcessTimeoutMs,
    });
    expect(install.status, `${install.stdout}${install.stderr}`).toBe(0);
    const probe = runTestProcess(
      process.execPath,
      [pi, "--mode", "rpc", "--no-session", "--extension", probeExtension],
      {
        cwd: consumer,
        env: { ...environment, PROBE_OUTPUT: probeOutput },
        isolatedHome: createTestWorkspace(),
        input: '{"type":"prompt","message":"/probe","id":"probe"}\n',
        timeout: packageProcessTimeoutMs,
      },
    );
    expect(probe.status, `${probe.stdout}${probe.stderr}`).toBe(0);
    const result = JSON.parse(readFileSync(probeOutput, "utf8")) as PiProbe;
    expect(result.prompt).toContain("but-why");
    expect(result.commands).toContain("skill:but-why");
  }, 60_000);

  it.effect(
    "loads installed continuation assets and forwards piped input to Herdr",
    () =>
      Effect.gen(function* () {
        const { installedPackage, installedRoot: installed } = prepared;
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
          '#!/usr/bin/env sh\nif [ "$1" = "repo" ] && [ "$2" = "view" ]; then printf \'{"defaultBranchRef":{"name":"main"}}\\n\'; exit 0; fi\nexit 1\n',
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
              runTestProcess(
                bin,
                ["change", "implement", change.id, "--implementer-prompt-file", "-"],
                {
                  cwd: repository,
                  env: {
                    ...env,
                    BY_FAKE_WORKTREE: change.worktreePath,
                    BY_FAKE_SESSION: change.id,
                  },
                  input: "Implementer prompt from piped stdin\n",
                  isolatedHome,
                  timeout: packageProcessTimeoutMs,
                },
              ),
            ),
          (server) => Effect.promise(server.stop),
        );
        expect(implement.status, `${implement.stdout}${implement.stderr}`).toBe(0);
        const startArgs = readFileSync(`${env.BY_FAKE_CAPTURE}.args`, "utf8");
        expect(startArgs).toContain(join(installedPackage, "extensions/continue-change.ts"));
        expect(startArgs).toContain(
          join(installedPackage, "docs/public/skills/but-why/references/command-guidance.md"),
        );
        expect(startArgs).toContain(
          join(installedPackage, "docs/public/skills/but-why/references/implement-change.md"),
        );
        const prompt = readFileSync(env.BY_FAKE_CAPTURE, "utf8");
        expect(prompt).toContain("Change identity:");
        expect(prompt).toContain("Implementer prompt from piped stdin");
      }),
    120_000,
  );

  it.skipIf(!realHerdrEnabled)(
    "runs the installed package through the real Herdr normal flow",
    () => {
      const temporaryRoot = mkdtempSync(join(tmpdir(), "but-why-real-herdr-"));
      const repositoryPath = join(temporaryRoot, "repository");
      const isolatedHome = join(temporaryRoot, "home");
      const socketPath = join(isolatedHome, ".config/herdr/herdr.sock");
      const globalConfigDirectory = join(isolatedHome, ".config/but-why");
      const bin = join(prepared.installedRoot, "node_modules", ".bin", "by");
      mkdirSync(globalConfigDirectory, { recursive: true });
      const profile = {
        agentRuntime: "pi",
        runtimeConfig: { model: "openai-codex/gpt-5.6-luna" },
      } as const;
      writeFileSync(
        join(globalConfigDirectory, "config.json"),
        JSON.stringify({
          defaultAgentProfile: { scope: "global", name: "pi" },
          interactiveSession: { agentProfile: { scope: "global", name: "implementer" } },
          review: {
            acceptance: { agentProfile: { scope: "global", name: "reviewer" } },
            task: { agentProfile: { scope: "global", name: "task-reviewer" } },
          },
          agentProfiles: {
            pi: profile,
            implementer: profile,
            reviewer: profile,
            "task-reviewer": profile,
          },
        }),
        "utf8",
      );

      const server = startTestProcess(
        "env",
        [
          "-u",
          "HERDR_SOCKET_PATH",
          `XDG_CONFIG_HOME=${join(isolatedHome, ".config")}`,
          "herdr",
          "server",
        ],
        { cwd: temporaryRoot, isolatedHome },
      );
      server.stdout.resume();
      server.stderr.resume();
      let createdWorkspaceId: string | undefined;

      try {
        waitForHerdr(temporaryRoot, isolatedHome, socketPath);
        expect(listHerdrWorkspaces(temporaryRoot, isolatedHome, socketPath)).toEqual([]);
        mkdirSync(repositoryPath);
        createGitRepo(repositoryPath);
        executeRealHerdrCommand(
          bin,
          ["init", "--id-prefix", "BY"],
          repositoryPath,
          isolatedHome,
          socketPath,
        );
        commitButWhyConfigAndRecordDefault(repositoryPath);
        const started = JSON.parse(
          executeRealHerdrCommand(
            bin,
            ["change", "start"],
            repositoryPath,
            isolatedHome,
            socketPath,
          ),
        ) as { readonly change?: { readonly id?: unknown } };
        const changeId = started.change?.id;
        expect(typeof changeId).toBe("string");
        if (typeof changeId !== "string") {
          throw new Error("Installed Change Start did not return an ID.");
        }
        const implementation = JSON.parse(
          executeRealHerdrCommand(
            bin,
            ["change", "implement", changeId],
            repositoryPath,
            isolatedHome,
            socketPath,
          ),
        ) as Readonly<Record<string, unknown>> & { readonly worktreePath?: unknown };

        expect(implementation).toMatchObject({
          changeId: "BY-C1",
          host: "herdr",
          status: "started",
        });
        const worktreePath = implementation.worktreePath;
        expect(typeof worktreePath).toBe("string");

        const createdWorkspaces = listHerdrWorkspaces(temporaryRoot, isolatedHome, socketPath);
        expect(createdWorkspaces).toHaveLength(1);
        const workspace = createdWorkspaces[0];
        createdWorkspaceId = String(workspace?.workspace_id);
        expect(workspace).toMatchObject({ label: "by-c1" });
        expect(workspace).not.toHaveProperty("worktree");

        const paneResponse = JSON.parse(
          executeRealHerdrCommand(
            "herdr",
            ["pane", "list", "--workspace", createdWorkspaceId],
            temporaryRoot,
            isolatedHome,
            socketPath,
          ),
        ) as { readonly result?: { readonly type?: string; readonly panes?: unknown } };
        expect(paneResponse.result?.type).toBe("pane_list");
        expect(paneResponse.result?.panes).toEqual([
          expect.objectContaining({ cwd: worktreePath, workspace_id: createdWorkspaceId }),
        ]);
      } finally {
        if (createdWorkspaceId !== undefined) {
          try {
            executeRealHerdrCommand(
              "herdr",
              ["workspace", "close", createdWorkspaceId],
              temporaryRoot,
              isolatedHome,
              socketPath,
            );
          } catch {
            // Stopping the dedicated server below contains remaining isolated state.
          }
        }
        try {
          executeRealHerdrCommand(
            "herdr",
            ["server", "stop"],
            temporaryRoot,
            isolatedHome,
            socketPath,
          );
        } catch {
          if (server.exitCode === null) server.kill("SIGTERM");
        }
        rmSync(temporaryRoot, { force: true, recursive: true });
      }
    },
    realHerdrTestTimeoutMs,
  );
});
