import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";

import { runByInProcessEffect } from "../support/by-cli.js";
import { createInitializedRepo } from "../support/initializedRepo.js";
import { runTestProcess } from "../support/testProcess.js";

describe("Change Submit validation-policy errors", () => {
  it.effect("reports a missing scoped profile through the serialized CLI result", () =>
    Effect.gen(function* () {
      const root = preparedRepository({
        review: {
          specialists: ["standards"],
        },
        reviewers: {
          standards: {
            instructionsFile: "standards.md",
            agentProfile: { scope: "repo", name: "missing-reviewer" },
          },
        },
      });
      writeFileSync(join(root, "standards.md"), "Review standards.\n");
      commit(root, "Add reviewer configuration");

      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"]);
      const startedOutput = JSON.parse(started.stdout);
      const changeId = startedOutput.change.id as string;
      writeFileSync(join(startedOutput.worktreePath, "change.txt"), "changed\n");
      commit(startedOutput.worktreePath, "Make a Change");
      const submitted = yield* runByInProcessEffect(root, ["--json", "change", "submit", changeId]);
      const output = JSON.parse(submitted.stdout);

      expect(submitted.status).toBe(1);
      expect(output.error).toMatchObject({
        code: "validation_policy_invalid",
        message: 'Agent Profile "missing-reviewer" in repo scope was not found.',
      });
      expect(output.help).toContain("Fix Repo Config or Global Config, then retry Change Submit.");
      const shown = yield* runByInProcessEffect(root, ["--json", "change", "show", changeId]);
      expect(JSON.parse(shown.stdout).currentValidationRun).toBeNull();
    }),
  );

  it.effect("preserves Global Config path and contract diagnostics", () =>
    Effect.gen(function* () {
      const root = preparedRepository({});
      const globalConfigPath = join(root, "global-config.json");
      writeFileSync(globalConfigPath, "{ invalid");
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"]);
      const startedOutput = JSON.parse(started.stdout);
      const changeId = startedOutput.change.id as string;
      writeFileSync(join(startedOutput.worktreePath, "change.txt"), "changed\n");
      commit(startedOutput.worktreePath, "Make a Change");
      const submitted = yield* runByInProcessEffect(
        root,
        ["--json", "change", "submit", changeId],
        "2026-06-30T12:00:00.000Z",
        { globalConfigPath },
      );
      const output = JSON.parse(submitted.stdout);

      expect(submitted.status).toBe(1);
      expect(output.error.code).toBe("validation_policy_invalid");
      expect(output.error.message).not.toBe("");
      expect(output.error.path).toBe(globalConfigPath);
      expect(output.error.diagnostics).toEqual(expect.any(Array));
    }),
  );
});

const preparedRepository = (config: Record<string, unknown>): string => {
  const root = createInitializedRepo();
  git(root, "config", "user.name", "But Why Test");
  git(root, "config", "user.email", "but-why@example.test");
  git(root, "branch", "-M", "main");
  writeFileSync(
    join(root, ".but-why/config.json"),
    JSON.stringify({
      taskPrefix: "BY",
      validation: { checks: [{ id: "quality", command: "true" }] },
      ...config,
    }),
  );
  writeFileSync(join(root, "README.md"), "# Test repository\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Initialize repository");
  git(root, "config", `url.${root}.insteadOf`, "https://github.com/acme/repo.git");
  git(root, "remote", "add", "origin", "https://github.com/acme/repo.git");
  git(root, "update-ref", "refs/remotes/origin/main", "refs/heads/main");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return root;
};

const commit = (root: string, message: string): void => {
  git(root, "add", ".");
  git(root, "commit", "-m", message);
};

const git = (cwd: string, ...args: string[]): void => {
  const result = runTestProcess("git", args, { cwd });
  if (result.status !== 0) throw new Error(result.stderr);
};
