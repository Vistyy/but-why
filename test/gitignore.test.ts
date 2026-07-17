import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { butWhyGitignoreBlock, ensureGitignoreBlock } from "../src/init/gitignore.js";
import { cleanupTempRoots, createTempRoot } from "./support/by-cli.js";

afterEach(cleanupTempRoots);

describe("managed Git ignore block", () => {
  it("creates the complete block with a trailing newline", () => {
    const path = gitignorePath();

    expect(ensureGitignoreBlock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`${butWhyGitignoreBlock}\n`);
    expect(ensureGitignoreBlock(path)).toBe(false);
  });

  it("appends the block after existing entries", () => {
    const path = gitignorePath("dist/\n");

    expect(ensureGitignoreBlock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`dist/\n\n${butWhyGitignoreBlock}\n`);
  });

  it("normalizes duplicate managed blocks to one", () => {
    const path = gitignorePath(
      `before/\n\n${butWhyGitignoreBlock}\n\n${butWhyGitignoreBlock}\n\nafter/\n`,
    );

    expect(ensureGitignoreBlock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`before/\n\nafter/\n\n${butWhyGitignoreBlock}\n`);
  });

  it("normalizes a managed block without a trailing newline", () => {
    const path = gitignorePath(butWhyGitignoreBlock);

    expect(ensureGitignoreBlock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`${butWhyGitignoreBlock}\n`);
  });

  it("replaces an incomplete block while preserving surrounding entries", () => {
    const path = gitignorePath(
      "before/\n\n# But Why?\n.sandcastle/worktrees/\n.sandcastle/logs/\n\nafter/\n",
    );

    expect(ensureGitignoreBlock(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`before/\n\nafter/\n\n${butWhyGitignoreBlock}\n`);
  });
});

const gitignorePath = (content?: string): string => {
  const path = join(createTempRoot(), ".gitignore");

  if (content !== undefined) writeFileSync(path, content);

  return path;
};
