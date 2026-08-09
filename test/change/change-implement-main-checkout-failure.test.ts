import { cpSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import {
  commitButWhyConfigAndRecordDefault,
  repoRoot,
  runByInProcessEffect,
} from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import { runTestProcess, runTestProcessOrThrow } from "../support/testProcess.js";
import { acquireTestWorkspace, releaseTestWorkspace } from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";
const mainCheckoutFailureProcessTimeoutMs = 10_000;
const mainCheckoutFailureTestTimeoutMs = 45_000;
let readyRepositoryTemplate: string;

beforeAll(() => {
  readyRepositoryTemplate = acquireTestWorkspace();
  const root = createInitializedRepo(readyRepositoryTemplate);
  cpSync(join(repoRoot, "bin"), join(root, "bin"), { recursive: true });
  cpSync(join(repoRoot, "package.json"), join(root, "package.json"));
  cpSync(join(repoRoot, "justfile"), join(root, "justfile"));
  commitButWhyConfigAndRecordDefault(root);
  runTestProcessOrThrow("git", ["add", "bin", "package.json", "justfile"], {
    cwd: root,
    timeout: mainCheckoutFailureProcessTimeoutMs,
  });
  runTestProcessOrThrow("git", ["commit", "-m", "Add source launcher"], {
    cwd: root,
    timeout: mainCheckoutFailureProcessTimeoutMs,
  });
});

afterAll(() => {
  releaseTestWorkspace(readyRepositoryTemplate);
});

const readyRepository = () => cloneInitializedTestRepository(readyRepositoryTemplate);

describe("Change Implement canonical main checkout failures", () => {
  it.effect(
    "returns a retryable error without changing the Change",
    () =>
      Effect.gen(function* () {
        const root = yield* readyRepository();
        const linkedCheckout = join(dirname(root), `${basename(root)}-linked-caller`);
        runTestProcessOrThrow(
          "git",
          ["worktree", "add", "-b", "linked-caller", linkedCheckout, "main"],
          { cwd: root, timeout: mainCheckoutFailureProcessTimeoutMs },
        );
        const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
        const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
        const before = yield* runByInProcessEffect(
          root,
          ["--json", "change", "show", change.change.id],
          now,
        );
        const trustedExecutable = join(root, "bin/by");
        rmSync(trustedExecutable);

        try {
          const result = runTestProcessOrThrowResult(
            "just",
            ["by", "--json", "change", "implement", change.change.id],
            linkedCheckout,
          );

          expect(result.status).toBe(1);
          expect(result.stderr).toBe("");
          expect(JSON.parse(result.stdout)).toEqual({
            error: {
              code: "trusted_executable_unavailable",
              message: "The canonical main-checkout Trusted But Why Executable is unavailable.",
              path: trustedExecutable,
            },
            help: [
              "Restore the canonical main-checkout Trusted But Why Executable, then retry the command.",
            ],
          });
        } finally {
          runTestProcessOrThrow("git", ["worktree", "remove", "--force", linkedCheckout], {
            cwd: root,
            timeout: mainCheckoutFailureProcessTimeoutMs,
          });
        }

        const after = yield* runByInProcessEffect(
          root,
          ["--json", "change", "show", change.change.id],
          now,
        );
        expect(after.stdout).toBe(before.stdout);
      }),
    mainCheckoutFailureTestTimeoutMs,
  );
});

const runTestProcessOrThrowResult = (command: string, args: readonly string[], cwd: string) => {
  const result = runTestProcess(command, args, {
    cwd,
    timeout: mainCheckoutFailureProcessTimeoutMs,
  });
  if (result.error !== undefined) throw result.error;
  return result;
};
