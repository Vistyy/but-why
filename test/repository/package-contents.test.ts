import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

type PackedPackageMetadata = {
  readonly files: readonly { readonly path: string }[];
};

describe("CLI package contents", () => {
  it("packs built CLI output and public package metadata only", () => {
    const fixture = createTestWorkspace();
    cpSync(join(repoRoot, "package.json"), join(fixture, "package.json"));
    cpSync(join(repoRoot, "README.md"), join(fixture, "README.md"));
    mkdirSync(join(fixture, "docs"));
    cpSync(join(repoRoot, "docs", "public"), join(fixture, "docs", "public"), {
      recursive: true,
    });
    for (const directory of ["dist", "src", "test", "spikes", "docs/issues"]) {
      mkdirSync(join(fixture, directory), { recursive: true });
    }
    writeFileSync(join(fixture, "dist", "main.js"), "#!/usr/bin/env node\n");
    writeFileSync(join(fixture, "src", "main.ts"), "export {};\n");
    writeFileSync(join(fixture, "test", "main.test.ts"), "export {};\n");
    writeFileSync(join(fixture, "spikes", "prototype.ts"), "export {};\n");
    writeFileSync(join(fixture, "docs", "issues", "draft.md"), "# Draft\n");
    writeFileSync(join(fixture, "justfile"), "default:\n");

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

    expect(files).toContain("dist/main.js");
    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("docs/public/config.md");
    expect(files).toContain("docs/public/setup.md");
    expect(files).toContain("docs/public/skills/but-why/SKILL.md");
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
  });
});
