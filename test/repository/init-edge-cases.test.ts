import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { isIdPrefix } from "../../src/contracts/idPrefix.js";
import { initializeRepositoryRuntime } from "../../src/repositoryRuntime/repositoryContext.js";
import { createGitRepo, runByInProcessEffect } from "../support/by-cli.js";

const writeConfig = (root: string, idPrefix = "BY") => {
  mkdirSync(join(root, ".but-why"), { recursive: true });
  writeFileSync(join(root, ".but-why/config.json"), `${JSON.stringify({ idPrefix }, null, 2)}\n`);
};

describe("by init edge cases", () => {
  it.each([
    ["BY"],
    ["A1"],
    ["ABC123"],
    ["A123456789"],
  ])("accepts valid ID Prefix %s", (idPrefix) => {
    expect(isIdPrefix(idPrefix)).toBe(true);
  });

  it.each([
    ["B"],
    ["by"],
    ["1BY"],
    ["BY-1"],
    ["A1234567890"],
    [""],
  ])("rejects invalid ID Prefix %j", (idPrefix) => {
    expect(isIdPrefix(idPrefix)).toBe(false);
  });

  it.effect("initializes when .but-why exists without config", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      mkdirSync(join(root, ".but-why"));
      const result = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).init.status).toBe("initialized");
      expect(JSON.parse(readFileSync(join(root, ".but-why/config.json"), "utf8"))).toEqual({
        idPrefix: "BY",
      });
    }),
  );

  it.effect("fails when the reviewers path is a file", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      writeConfig(root);
      writeFileSync(join(root, ".but-why/reviewers"), "not a directory");
      const result = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "invalid_repo_state",
          message: ".but-why/reviewers/ must be a directory.",
          path: ".but-why/reviewers/",
        },
        help: ["Move the conflicting path aside before running init again."],
      });
      expect(existsSync(join(root, ".but-why/reviewers"))).toBe(true);
    }),
  );

  it.effect("initializes repository state through the scoped SQL service", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const result = yield* initializeRepositoryRuntime({ cwd: root, idPrefix: "BY" });

      expect(result).toMatchObject({ ok: true, status: "initialized" });
      expect(existsSync(join(root, ".git", "but-why", "state.sqlite"))).toBe(true);
    }),
  );

  it.effect("is unchanged when the current state database already exists", () =>
    Effect.gen(function* () {
      const root = createGitRepo();

      expect((yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"])).status).toBe(0);
      const result = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).init.status).toBe("unchanged");
    }),
  );

  it.effect("reports state_store_unavailable when Shared Repository State cannot be opened", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      mkdirSync(join(root, ".git", "but-why", "state.sqlite"), { recursive: true });

      const result = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "state_store_unavailable",
          message: "Shared But Why? state is unavailable.",
        },
        help: ["Restore <git-common-dir>/but-why/state.sqlite, then run `by init --id-prefix BY`."],
      });
    }),
  );

  it.effect("reports state_store_unavailable when Shared Repository State migration fails", () =>
    Effect.gen(function* () {
      const root = createGitRepo();
      const statePath = join(root, ".git", "but-why", "state.sqlite");
      mkdirSync(join(root, ".git", "but-why"), { recursive: true });
      writeFileSync(statePath, "not sqlite");

      const result = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: {
          code: "state_store_unavailable",
          message: "Shared But Why? state is unavailable.",
        },
        help: ["Restore <git-common-dir>/but-why/state.sqlite, then run `by init --id-prefix BY`."],
      });
    }),
  );
});
