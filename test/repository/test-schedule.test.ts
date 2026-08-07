import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  approvedCompleteOnlyTestFiles,
  assertValidSchedule,
  completeOnlyTestFiles,
  scheduleErrors,
  smokeOrManualTestFiles,
} from "../suiteSchedule.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const testRoot = join(repositoryRoot, "test");

const maintainedTestFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return maintainedTestFiles(path);
    return entry.isFile() && entry.name.endsWith(".test.ts")
      ? [relative(repositoryRoot, path)]
      : [];
  });

const actualMaintainedTestFiles = [...maintainedTestFiles(testRoot)].sort();
const baseSchedule = {
  maintainedTestFiles: actualMaintainedTestFiles,
  completeOnlyTestFiles,
  smokeOrManualTestFiles,
  approvedCompleteOnlyTestFiles,
};

describe("maintained test scheduling", () => {
  test("assigns every maintained test exactly one complete-only, smoke or manual, or derived routine owner", () => {
    assertValidSchedule(baseSchedule);

    const completeOnly = new Set<string>(completeOnlyTestFiles);
    const smokeOrManual = new Set<string>(smokeOrManualTestFiles);
    const routine = actualMaintainedTestFiles.filter(
      (file) => !completeOnly.has(file) && !smokeOrManual.has(file),
    );

    expect(new Set(actualMaintainedTestFiles).size).toBe(actualMaintainedTestFiles.length);
    expect(new Set([...completeOnly, ...smokeOrManual, ...routine]).size).toBe(
      actualMaintainedTestFiles.length,
    );
    expect(routine).not.toContain("test/change/change-implement-main-checkout-failure.test.ts");
    expect(completeOnlyTestFiles).toContain(
      "test/change/change-implement-main-checkout-failure.test.ts",
    );
  });

  test.each([
    [
      "omitted approved entry",
      {
        completeOnlyTestFiles: completeOnlyTestFiles.filter(
          (file) => !approvedCompleteOnlyTestFiles.some((approved) => approved === file),
        ),
      },
    ],
    [
      "nonexistent entry",
      { completeOnlyTestFiles: [...completeOnlyTestFiles, "test/missing.test.ts"] },
    ],
    [
      "duplicate entry",
      { completeOnlyTestFiles: [...completeOnlyTestFiles, completeOnlyTestFiles[0]] },
    ],
    [
      "smoke or manual ownership conflict",
      { completeOnlyTestFiles: [...completeOnlyTestFiles, smokeOrManualTestFiles[0]] },
    ],
  ] as const)("rejects a %s", (_reason, change) => {
    const errors = scheduleErrors({ ...baseSchedule, ...change });
    expect(errors.length).toBeGreaterThan(0);
  });
});
