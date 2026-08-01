import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

describe("CLI loading and package boundary", () => {
  it("builds literal lazy targets and runs the real packed package", () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-cli-package-"));
    try {
      const build = runTestProcess("pnpm", ["--dir", repoRoot, "build"], { cwd: directory });
      expect(build.status, build.stderr || build.stdout).toBe(0);

      const tree = readFileSync(join(repoRoot, "dist/cliCommandTree.js"), "utf8");
      expect(tree).not.toMatch(/from "\.\/cli\/change\//);
      expect(tree).toContain('import("./cli/change/start.js")');
      expect(tree).toContain('import("./cli/change/submit.js")');
      expect(tree).toContain('import("./cli/task/commands/list.js")');
      const dynamicTargets = [...tree.matchAll(/import\("(\.\/[^\"]+)"\)/g)].flatMap(
        ([, target]) => (target === undefined ? [] : [target]),
      );
      expect(dynamicTargets.length).toBeGreaterThan(10);

      const packed = runTestProcess(
        "pnpm",
        ["--dir", repoRoot, "pack", "--pack-destination", directory],
        { cwd: directory },
      );
      expect(packed.status, packed.stderr || packed.stdout).toBe(0);
      const tarball = join(directory, "but-why-0.0.1.tgz");
      expect(existsSync(tarball)).toBe(true);

      const consumer = join(directory, "consumer");
      mkdirSync(consumer);
      const installed = runTestProcess("pnpm", ["add", "--dir", consumer, tarball], {
        cwd: directory,
      });
      expect(installed.status, installed.stderr || installed.stdout).toBe(0);
      for (const target of dynamicTargets) {
        expect(existsSync(join(consumer, "node_modules/but-why/dist", target.slice(2)))).toBe(true);
      }

      for (const args of [["--help"], ["--version"]]) {
        const result = runTestProcess(join(consumer, "node_modules/.bin/by"), args, {
          cwd: consumer,
        });
        expect(result.status, result.stderr || result.stdout).toBe(0);
      }
      for (const args of [
        ["task", "list"],
        ["change", "list"],
        ["validation-run", "show", "missing"],
      ]) {
        const result = runTestProcess(join(consumer, "node_modules/.bin/by"), args, {
          cwd: consumer,
        });
        expect(result.status, result.stderr || result.stdout).not.toBe(127);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
