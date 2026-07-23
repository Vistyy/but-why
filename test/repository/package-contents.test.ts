import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";

type PackedPackageMetadata = {
  readonly files: readonly { readonly path: string }[];
};

describe("CLI package contents", () => {
  it("packs built CLI output and public package metadata only", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: repoRoot,
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
