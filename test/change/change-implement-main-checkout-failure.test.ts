import { chmodSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, beforeAll, describe } from "vitest";

import {
  commitButWhyConfigAndRecordDefault,
  runByInProcessEffect,
  runByWithEnv,
} from "../support/by-cli.js";
import {
  cloneInitializedTestRepository,
  createInitializedRepo,
} from "../support/initializedRepo.js";
import { runTestProcessOrThrow } from "../support/testProcess.js";
import {
  acquireTestWorkspace,
  createTestWorkspace,
  releaseTestWorkspace,
} from "../support/testWorkspace.js";

const now = "2026-06-30T12:00:00.000Z";
let readyRepositoryTemplate: string;

beforeAll(() => {
  readyRepositoryTemplate = acquireTestWorkspace();
  const root = createInitializedRepo(readyRepositoryTemplate);
  commitButWhyConfigAndRecordDefault(root);
});

afterAll(() => {
  releaseTestWorkspace(readyRepositoryTemplate);
});

const readyRepository = () => cloneInitializedTestRepository(readyRepositoryTemplate);

describe("Change Implement canonical main checkout failures", () => {
  it.effect("returns a retryable error without changing the Change", () =>
    Effect.gen(function* () {
      const root = yield* readyRepository();
      const linkedCheckout = join(dirname(root), `${basename(root)}-linked-caller`);
      runTestProcessOrThrow(
        "git",
        ["worktree", "add", "-b", "linked-caller", linkedCheckout, "main"],
        { cwd: root },
      );
      const started = yield* runByInProcessEffect(root, ["--json", "change", "start"], now);
      const change = JSON.parse(started.stdout) as { readonly change: { readonly id: string } };
      const before = yield* runByInProcessEffect(
        root,
        ["--json", "change", "show", change.change.id],
        now,
      );
      const fakeGitDirectory = createTestWorkspace();
      const fakeGitPath = join(fakeGitDirectory, "git");
      const realGitPath = runTestProcessOrThrow("which", ["git"], { cwd: root });
      writeFileSync(
        fakeGitPath,
        `#!/bin/sh
if [ "$1" = "worktree" ] && [ "$2" = "list" ]; then
  exit 1
fi
exec ${realGitPath} "$@"
`,
      );
      chmodSync(fakeGitPath, 0o755);

      try {
        // biome-ignore lint/complexity/useLiteralKeys: NodeJS.ProcessEnv has an index signature.
        const inheritedPath = process.env["PATH"] ?? "";
        const result = runByWithEnv(
          linkedCheckout,
          { PATH: `${fakeGitDirectory}:${inheritedPath}` },
          "--json",
          "change",
          "implement",
          change.change.id,
        );

        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          error: {
            code: "main_checkout_unavailable",
            message: "The Local Repository's canonical main checkout is unavailable.",
          },
          help: ["Restore the canonical main checkout, then retry the command."],
        });
      } finally {
        runTestProcessOrThrow("git", ["worktree", "remove", "--force", linkedCheckout], {
          cwd: root,
        });
      }

      const after = yield* runByInProcessEffect(
        root,
        ["--json", "change", "show", change.change.id],
        now,
      );
      expect(after.stdout).toBe(before.stdout);
    }),
  );
});
