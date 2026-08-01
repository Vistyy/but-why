import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { join } from "node:path";
import { describe, vi } from "vitest";
import { expect, it } from "@effect/vitest";

import { repoRoot } from "../support/by-cli.js";
import { runTestProcess } from "../support/testProcess.js";

vi.setConfig({ testTimeout: 30_000 });

describe("CLI loading and package boundary", () => {
  it.effect(
    "builds literal lazy targets and runs the real packed package",
    () =>
      Effect.gen(function* () {
        const directory = mkdtempSync(join(tmpdir(), "but-why-cli-package-"));
        try {
          const build = runTestProcess("pnpm", ["--dir", repoRoot, "build"], { cwd: directory });
          expect(build.status, build.stderr || build.stdout).toBe(0);

          const tree = readFileSync(join(repoRoot, "dist/cliCommandTree.js"), "utf8");
          expect(tree).not.toMatch(/from "\.\/cli\/(task|change|validationRun|initCli|dashboard)/);
          expect(tree).toContain('import("./cli/change/start.js")');
          expect(tree).toContain('import("./cli/change/submit.js")');
          expect(tree).toContain('import("./cli/task/commands/list.js")');
          const dynamicTargets = [...tree.matchAll(/import\("(\.\/[^"]+)"\)/g)].flatMap(
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
            expect(existsSync(join(consumer, "node_modules/but-why/dist", target.slice(2)))).toBe(
              true,
            );
          }

          for (const args of [["--help"], ["--version"]]) {
            const result = runTestProcess(join(consumer, "node_modules/.bin/by"), args, {
              cwd: consumer,
            });
            expect(result.status, result.stderr || result.stdout).toBe(0);
          }
          const gitInit = runTestProcess("git", ["init", "-q"], { cwd: consumer });
          expect(gitInit.status, gitInit.stderr || gitInit.stdout).toBe(0);
          const installedBy = join(consumer, "node_modules/.bin/by");
          const initialized = runTestProcess(installedBy, ["init", "--task-prefix", "BY"], {
            cwd: consumer,
          });
          expect(initialized.status, initialized.stderr || initialized.stdout).toBe(0);
          for (const args of [
            ["task", "list"],
            ["change", "list"],
          ]) {
            const result = runTestProcess(installedBy, args, { cwd: consumer });
            expect(result.status, result.stderr || result.stdout).toBe(0);
          }
          const validationShow = runTestProcess(
            installedBy,
            ["validation-run", "show", "missing"],
            { cwd: consumer },
          );
          expect(validationShow.status).not.toBe(127);
          expect(validationShow.stdout + validationShow.stderr).toContain("error:");
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }),
    30_000,
  );
});
