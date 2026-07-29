import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

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

describe("CLI package contents", () => {
  it("packs built CLI output and public package metadata only", () => {
    const fixture = createTestWorkspace();
    cpSync(join(repoRoot, "package.json"), join(fixture, "package.json"));
    cpSync(join(repoRoot, "README.md"), join(fixture, "README.md"));
    cpSync(join(repoRoot, "CHANGELOG.md"), join(fixture, "CHANGELOG.md"));
    mkdirSync(join(fixture, "docs"));
    cpSync(join(repoRoot, "docs", "public"), join(fixture, "docs", "public"), {
      recursive: true,
    });
    for (const directory of ["dist", "src", "test", "spikes", "docs/issues"]) {
      mkdirSync(join(fixture, directory), { recursive: true });
    }
    writeFileSync(join(fixture, "dist", "main.js"), "#!/usr/bin/env node\n");
    mkdirSync(join(fixture, "dist", "sqlite"));
    mkdirSync(join(fixture, "dist", "agent"));
    mkdirSync(join(fixture, "dist", "acceptanceReview"));
    writeFileSync(join(fixture, "dist", "sqlite", "repositoryMigrations.js"), "export {};\n");
    writeFileSync(join(fixture, "dist", "agent", "reviewerPrompts.js"), "export {};\n");
    writeFileSync(
      join(fixture, "dist", "agent", "continueChange.js"),
      "export default () => {};\n",
    );
    writeFileSync(
      join(fixture, "dist", "acceptanceReview", "acceptanceReviewPrompt.js"),
      "export {};\n",
    );
    writeFileSync(join(fixture, "src", "main.ts"), "export {};\n");
    writeFileSync(join(fixture, "test", "main.test.ts"), "export {};\n");
    writeFileSync(join(fixture, "spikes", "prototype.ts"), "export {};\n");
    writeFileSync(join(fixture, "docs", "issues", "draft.md"), "# Draft\n");
    writeFileSync(join(fixture, "justfile"), "default:\n");

    const manifest = JSON.parse(
      readFileSync(join(fixture, "package.json"), "utf8"),
    ) as PackageManifest;
    expect(manifest).toMatchObject({
      name: "but-why",
      version: "0.0.1",
      private: false,
      bin: { by: "./dist/main.js" },
      files: ["dist", "docs/public", "README.md", "CHANGELOG.md"],
      repository: { type: "git", url: "git+https://github.com/Vistyy/but-why.git" },
    });

    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
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
    expect(files).toContain("dist/agent/continueChange.js");
    expect(files).toContain("docs/public/skills/but-why/SKILL.md");
    expect(files).toContain("docs/public/skills/but-why/references/implement-change.md");
    expect(files.some((path) => path.startsWith("skills/"))).toBe(false);
    expect(files.some((path) => path.startsWith("src/"))).toBe(false);
    expect(files.some((path) => path.startsWith("test/"))).toBe(false);
    expect(files.some((path) => path.startsWith("spikes/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/issues/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/prds/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/adr/"))).toBe(false);
    expect(files.some((path) => path.startsWith("docs/spikes/"))).toBe(false);
    expect(files).not.toContain("docs/open-questions.md");
    expect(files).not.toContain("bin/by");
    expect(files).not.toContain("justfile");
    expect(readFileSync(join(fixture, "CHANGELOG.md"), "utf8")).toContain("Source tag: `v0.0.1`");
  });
});
