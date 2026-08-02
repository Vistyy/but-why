import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";
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
  cpSync(join(repoRoot, "extensions"), join(packageRoot, "extensions"), { recursive: true });
  mkdirSync(join(packageRoot, "docs"));
  cpSync(join(repoRoot, "docs", "public"), join(packageRoot, "docs", "public"), {
    recursive: true,
  });
};

describe("CLI package contents", () => {
  it("loads continuation from the installed package", async () => {
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
    const installRoot = join(packageRoot, "installed");
    const installed = runTestProcess(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installRoot,
        join(packageRoot, filename),
      ],
      { cwd: packageRoot },
    );
    expect(installed.error).toBeUndefined();
    expect(installed.status).toBe(0);

    const installedPackage = join(installRoot, "node_modules", "but-why");
    const extension = join(installedPackage, "extensions/continue-change.ts");
    const advisorExtension = join(installedPackage, "extensions/implementation-advisor/index.ts");
    expect(readFileSync(advisorExtension, "utf8")).toContain("implementation_advice");
    const installedAdvisor = (await import(pathToFileURL(advisorExtension).href)) as {
      readonly default: unknown;
    };
    expect(typeof installedAdvisor.default).toBe("function");
    const module = (await import(
      pathToFileURL(join(installedPackage, "dist/change/herdrInteractiveSessionHost.js")).href
    )) as typeof import("../../src/change/herdrInteractiveSessionHost.js");
    const commands: string[][] = [];
    const execute = async (args: readonly string[]) => {
      commands.push([...args]);
      if (args[0] === "agent" && args[1] === "list") {
        return commands.some(([command]) => command === "pane")
          ? {
              ok: true as const,
              stdout:
                '{"result":{"type":"agent_list","agents":[{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1","agent_status":"working"}]}}',
            }
          : { ok: true as const, stdout: '{"result":{"type":"agent_list","agents":[]}}' };
      }
      if (args[0] === "worktree") {
        return {
          ok: true as const,
          stdout:
            '{"result":{"type":"worktree_opened","workspace":{"workspace_id":"workspace-1"},"root_pane":{"pane_id":"workspace-1:pane-1"},"already_open":false}}',
        };
      }
      if (args[0] === "agent" && args[1] === "rename") {
        return {
          ok: true as const,
          stdout:
            '{"result":{"agent":{"name":"but-why-change-123","cwd":"/workspace/change-123","pane_id":"workspace-1:pane-1"}}}',
        };
      }
      return { ok: true as const, stdout: "{}" };
    };
    const input = {
      changeId: "change-123",
      repositoryPath: "/repository",
      worktreePath: "/workspace/change-123",
      initialPrompt: "Implement",
    };

    await expect(
      module.openHerdrInteractiveSessionHost(execute).launch(input),
    ).resolves.toMatchObject({
      ok: true,
      status: "started",
    });
    expect(commands.find(([command]) => command === "pane")?.[3]).toContain(
      `--extension '${extension}'`,
    );

    commands.length = 0;
    rmSync(extension);
    await expect(
      module.openHerdrInteractiveSessionHost(execute).launch(input),
    ).resolves.toMatchObject({
      ok: false,
      code: "launch_failed",
      message: expect.stringContaining("Required trusted continuation extension is missing"),
    });
    expect(commands).toEqual([]);
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
    expect(files).toContain("extensions/implementation-advisor/index.ts");
    expect(files).toContain("extensions/implementation-advisor/rules.ts");
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
