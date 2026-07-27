import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const biomeExecutable = join(repoRoot, "node_modules/.bin/biome");
const vitestExecutable = join(repoRoot, "node_modules/.bin/vitest");
const vitestConfig = join(repoRoot, "vitest.config.ts");
const nestedWorkspace = ".sandcastle/worktrees/validation";
const nestedTestMarker = "nested Validation Workspace test was discovered";

describe("recursive repository tooling exclusions", () => {
  it("ignores a nested Validation Workspace during Biome and Vitest discovery", () => {
    const fixture = createToolingFixture();
    const result = spawnSync(
      "just",
      ["--justfile", join(fixture, "justfile"), "--working-directory", fixture, "tooling-check"],
      { encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).not.toContain(nestedTestMarker);
  }, 30_000);
});

const createToolingFixture = (): string => {
  const fixture = createTestWorkspace();
  const nested = join(fixture, nestedWorkspace);
  mkdirSync(join(nested, "test"), { recursive: true });
  mkdirSync(join(fixture, "test"), { recursive: true });
  writeFileSync(join(fixture, "biome.json"), fixtureBiomeConfig);
  writeFileSync(join(fixture, "test/visible.test.ts"), visibleTest);
  writeFileSync(join(nested, "biome.json"), nestedBiomeConfig);
  writeFileSync(join(nested, "test/nested.test.ts"), nestedTest);
  writeFileSync(
    join(fixture, "justfile"),
    justfile
      .replaceAll("__BIOME__", biomeExecutable)
      .replaceAll("__VITEST__", vitestExecutable)
      .replaceAll("__VITEST_CONFIG__", vitestConfig),
  );
  return fixture;
};

const justfile = `
tooling-check:
    @"__BIOME__" check .
    @env BY_TEST_SUITE= "__VITEST__" run --config "__VITEST_CONFIG__" --root . --reporter=verbose
`;

const visibleTest = `import { expect, test } from "vitest";

test("visible fixture test", () => {
  expect(true).toBe(true);
});
`;

const nestedTest = `import { test } from "vitest";

test("${nestedTestMarker}", () => {
  throw new Error("${nestedTestMarker}");
});
`;

const fixtureBiomeConfig = `{
  "$schema": "https://biomejs.dev/schemas/2.5.1/schema.json",
  "files": {
    "includes": ["**/*", "!node_modules", "!.sandcastle"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  }
}
`;

const nestedBiomeConfig = `{
  "$schema": "https://biomejs.dev/schemas/2.5.1/schema.json",
  "files": {
    "includes": ["**/*.ts"]
  }
}
`;
