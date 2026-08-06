import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

vi.setConfig({ testTimeout: 360_000 });

describe("CLI loading and package boundary", () => {
  it("builds literal lazy targets and verifies generated dynamic targets exist in the built package", () => {
    const directory = mkdtempSync(join(tmpdir(), "but-why-cli-package-"));
    try {
      const build = runTestProcess("pnpm", ["--dir", repoRoot, "build"], { cwd: directory });
      expect(build.status, build.stderr || build.stdout).toBe(0);

      const entry = join(repoRoot, "dist/main.js");
      const entrySource = readFileSync(entry, "utf8");
      const staticEntryFiles = new Set<string>();
      const staticEntryQueue = [entry];
      while (staticEntryQueue.length > 0) {
        const entry = staticEntryQueue.pop();
        if (entry === undefined || staticEntryFiles.has(entry)) continue;
        staticEntryFiles.add(entry);
        const source = readFileSync(entry, "utf8");
        for (const match of source.matchAll(/from["'](\.\.?(?:\/)[^"']+)["']/g)) {
          const target = match[1];
          if (target !== undefined) staticEntryQueue.push(join(dirname(entry), target));
        }
      }
      expect([...staticEntryFiles].every((entry) => !entry.includes("/cli/task/"))).toBe(true);
      expect([...staticEntryFiles].every((entry) => !entry.includes("/cli/change/"))).toBe(true);
      expect([...staticEntryFiles].every((entry) => !entry.includes("/cli/validationRun/"))).toBe(
        true,
      );
      const dynamicTargets = [...entrySource.matchAll(/import\([`"](\.\/[^`"]+)[`"]\)/g)].flatMap(
        ([, target]) => (target === undefined ? [] : [target]),
      );
      expect(dynamicTargets.length).toBeGreaterThan(10);
      expect(
        dynamicTargets.every((target) => existsSync(join(repoRoot, "dist", target.slice(2)))),
      ).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
