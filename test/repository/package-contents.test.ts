import { chmodSync, cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createGitRepo, repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";
import { runTestProcess } from "../support/testProcess.js";

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
  readonly bin: { readonly by: string };
  readonly files: readonly string[];
  readonly repository: { readonly type: string; readonly url: string };
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

describe("CLI package contents", () => {
  it("packs bundled continuation support from the installed package", async () => {
    const packageRoot = createTestWorkspace();
    createPackageFixture(packageRoot);
    cpSync(join(repoRoot, "src"), join(packageRoot, "src"), { recursive: true });
    cpSync(join(repoRoot, "tsconfig.json"), join(packageRoot, "tsconfig.json"));
    cpSync(join(repoRoot, "tsconfig.build.json"), join(packageRoot, "tsconfig.build.json"));
    symlinkSync(join(repoRoot, "node_modules"), join(packageRoot, "node_modules"));
    const buildResult = runTestProcess("pnpm", ["run", "build"], { cwd: packageRoot });
    expect(buildResult.error).toBeUndefined();
    expect(buildResult.status).toBe(0);
    const packed = runTestProcess("npm", ["pack", "--ignore-scripts", "--json"], {
      cwd: packageRoot,
    });
    expect(packed.error).toBeUndefined();
    expect(packed.status).toBe(0);
    const [{ filename }] = JSON.parse(packed.stdout) as readonly [{ filename: string }];
    const installed = join(packageRoot, "installed");
    const installResult = runTestProcess(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installed,
        join(packageRoot, filename),
      ],
      { cwd: packageRoot },
    );
    expect(installResult.status).toBe(0);
    const installedPackage = join(installed, "node_modules", "but-why");
    expect(readFileSync(join(installedPackage, "extensions/continue-change.ts"), "utf8")).toContain(
      "continue-change",
    );

    const repository = createGitRepo();
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
if [ "$1" = "worktree" ] && [ "$2" = "open" ]; then
  printf '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace"},"root_pane":{"pane_id":"pane"},"already_open":false}}\\n'
  exit 0
fi
if [ "$1" = "pane" ] && [ "$2" = "run" ]; then
  printf '%s\\n' "$4" > "$BY_FAKE_CAPTURE"
  : > "$BY_FAKE_CAPTURE.started"
  printf '{"result":{}}\\n'
  exit 0
fi
if [ "$1" = "agent" ] && [ "$2" = "rename" ]; then
  printf '{"result":{"agent":{"name":"change-agent","cwd":"%s","pane_id":"pane"}}}\\n' "$BY_FAKE_WORKTREE"
  exit 0
fi
exit 1
`,
    );
    chmodSync(join(tools, "gh"), 0o755);
    chmodSync(join(tools, "herdr"), 0o755);
    const bin = join(installed, "node_modules", ".bin", "by");
    const env = {
      PATH: `${tools}:${process.env["PATH"] ?? ""}`,
      BY_FAKE_CAPTURE: join(repository, "herdr-capture.txt"),
    };
    const isolatedHome = createTestWorkspace();
    const init = runTestProcess(bin, ["init", "--task-prefix", "BY"], {
      cwd: repository,
      env,
      isolatedHome,
    });
    expect(init.status, `${init.stdout}${init.stderr}`).toBe(0);
    for (const args of [
      ["config", "user.name", "But Why Test"],
      ["config", "user.email", "but-why@example.test"],
      ["add", ".but-why/config.json", ".gitignore"],
      ["commit", "-m", "Initialize But Why"],
      ["branch", "-M", "main"],
      ["config", `url.${repository}.insteadOf`, "https://github.com/acme/repo.git"],
      ["remote", "add", "origin", "https://github.com/acme/repo.git"],
      ["update-ref", "refs/remotes/origin/main", "refs/heads/main"],
      ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    ]) {
      const git = runTestProcess("git", args, { cwd: repository, isolatedHome });
      expect(git.status, `${git.stdout}${git.stderr}`).toBe(0);
    }
    mkdirSync(join(isolatedHome, ".config", "but-why"), { recursive: true });
    writeFileSync(
      join(isolatedHome, ".config", "but-why", "config.json"),
      `${JSON.stringify({
        defaultAgentProfile: { scope: "global", name: "test" },
        agentProfiles: { test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } } },
      })}\n`,
    );
    const started = runTestProcess(bin, ["--json", "change", "start"], {
      cwd: repository,
      env,
      isolatedHome,
    });
    expect(started.status, `${started.stdout}${started.stderr}`).toBe(0);
    const change = JSON.parse(started.stdout) as {
      readonly change: { readonly id: string };
      readonly worktreePath: string;
    };
    const implement = runTestProcess(bin, ["--json", "change", "implement", change.change.id], {
      cwd: repository,
      env: {
        ...env,
        BY_FAKE_WORKTREE: change.worktreePath,
        BY_FAKE_SESSION: `change-${change.change.id.slice(0, 8)}`,
      },
      isolatedHome,
    });
    expect(implement.status, `${implement.stdout}${implement.stderr}`).toBe(0);
    expect(readFileSync(env.BY_FAKE_CAPTURE, "utf8")).toContain(
      `--extension '${join(installedPackage, "extensions/continue-change.ts")}'`,
    );
  }, 120_000);

  it("packs built CLI output and public package metadata only", () => {
    const fixture = createTestWorkspace();
    createPackageFixture(fixture);
    for (const directory of ["dist", "src", "test", "spikes"]) {
      mkdirSync(join(fixture, directory), { recursive: true });
    }
    writeFileSync(join(fixture, "dist", "main.js"), "#!/usr/bin/env node\n");
    mkdirSync(join(fixture, "dist", "sqlite"), { recursive: true });
    mkdirSync(join(fixture, "dist", "agent"), { recursive: true });
    mkdirSync(join(fixture, "dist", "acceptanceReview"), { recursive: true });
    writeFileSync(join(fixture, "dist", "sqlite", "repositoryMigrations.js"), "export {};\n");
    writeFileSync(join(fixture, "dist", "agent", "reviewerPrompts.js"), "export {};\n");
    writeFileSync(
      join(fixture, "dist", "acceptanceReview", "acceptanceReviewPrompt.js"),
      "export {};\n",
    );
    writeFileSync(join(fixture, "src", "main.ts"), "export {};\n");
    writeFileSync(join(fixture, "test", "main.test.ts"), "export {};\n");
    writeFileSync(join(fixture, "spikes", "prototype.ts"), "export {};\n");
    writeFileSync(join(fixture, "justfile"), "default:\n");

    const manifest = JSON.parse(
      readFileSync(join(fixture, "package.json"), "utf8"),
    ) as PackageManifest;
    expect(manifest).toMatchObject({
      name: "but-why",
      version: "0.0.1",
      private: false,
      bin: { by: "./dist/main.js" },
      files: ["dist", "extensions", "docs/public", "README.md", "CHANGELOG.md"],
      repository: { type: "git", url: "git+https://github.com/Vistyy/but-why.git" },
    });

    const result = runTestProcess("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: fixture,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);

    const [packedPackage] = JSON.parse(result.stdout) as readonly PackedPackageMetadata[];
    if (packedPackage === undefined) throw new Error("npm pack did not return a package");
    const files = packedPackage.files.map((file) => file.path).sort();

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
    expect(files).toContain("dist/main.js");
    expect(files).toContain("dist/sqlite/repositoryMigrations.js");
    expect(files).toContain("dist/agent/reviewerPrompts.js");
    expect(files).toContain("dist/acceptanceReview/acceptanceReviewPrompt.js");
    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("CHANGELOG.md");
    expect(files).toContain("docs/public/config.md");
    expect(files).toContain("docs/public/setup.md");
    expect(files).toContain("extensions/continue-change.ts");
    expect(files).toContain("docs/public/skills/but-why/SKILL.md");
    expect(files).toContain("docs/public/skills/but-why/references/implement-change.md");
    expect(files.some((path) => path.startsWith("skills/"))).toBe(false);
    expect(files.some((path) => path.startsWith("src/"))).toBe(false);
    expect(files.some((path) => path.startsWith("test/"))).toBe(false);
    expect(files.some((path) => path.startsWith("spikes/"))).toBe(false);
    expect(
      files.every((path) => !path.startsWith("docs/") || path.startsWith("docs/public/")),
    ).toBe(true);
    expect(files).not.toContain("bin/by");
    expect(files).not.toContain("justfile");
    expect(readFileSync(join(fixture, "CHANGELOG.md"), "utf8")).toContain("Source tag: `v0.0.1`");
  });
});
