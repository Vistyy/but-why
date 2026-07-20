import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { isTaskPrefix } from "../src/contracts/taskPrefix.js";
import { createGitRepo, runByInProcessEffect } from "./support/by-cli.js";

const writeConfig = (root: string, taskPrefix = "BY") => {
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why/config.json"), `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

describe("by init edge cases", () => {
  it.each([
    ["BY"],
    ["A1"],
    ["ABC123"],
    ["A123456789"],
  ])("accepts valid task prefix %s", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(true);
  });

  it.each([
    ["B"],
    ["by"],
    ["1BY"],
    ["BY-1"],
    ["A1234567890"],
    [""],
  ])("rejects invalid task prefix %j", (taskPrefix) => {
    expect(isTaskPrefix(taskPrefix)).toBe(false);
  });

  it.effect("initializes when .but-why exists without config", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      mkdirSync(join(root, ".but-why"));
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("status: initialized");
      expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
        taskPrefix: "BY",
      });
    }),
  );

  it.effect("fails when the reviewers path is a file", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      writeConfig(root);
      writeFileSync(join(root, ".but-why/reviewers"), "not a directory");
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`error:
  code: invalid_repo_state
  message: .but-why/reviewers/ must be a directory.
  path: .but-why/reviewers/
help[1]: Move the conflicting path aside before running init again.`);
      expect(existsSync(join(root, ".but-why/reviewers"))).toBe(true);
    }),
  );

  it.effect("is unchanged when an existing state database already has the init migration", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("status: unchanged");
    }),
  );
});
