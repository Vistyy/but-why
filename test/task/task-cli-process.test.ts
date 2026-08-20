import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  commitButWhyConfigAndRecordDefault,
  createGitRepo,
  passTaskReviewFixture,
  runBuiltByWithEnv,
  runBuiltByWithInput,
  runByInProcessEffect,
} from "../support/by-cli.js";

const expectExactlyOneTrailingLineFeed = (stdout: string): void => {
  const bytes = Buffer.from(stdout, "utf8");
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.at(-2)).not.toBe(0x0a);
};

describe("by task CLI process boundary", () => {
  it.effect(
    "revises a Todo Task through the packaged CLI boundary",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        expect((yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"])).status).toBe(0);
        expect(
          runBuiltByWithInput(
            root,
            "Original intent",
            {},
            "task",
            "create",
            "--title",
            "Approved intent",
            "--file",
            "-",
          ).status,
        ).toBe(0);
        yield* passTaskReviewFixture(root, "BY-1");

        const revised = runBuiltByWithEnv(root, {}, "task", "revise", "BY-1");
        expect(revised.status).toBe(0);
        expect(revised.stderr).toBe("");
        expectExactlyOneTrailingLineFeed(revised.stdout);
        expect(JSON.parse(revised.stdout)).toMatchObject({
          task: { id: "BY-1", state: "new", changed: true },
        });

        const context = yield* runByInProcessEffect(root, ["task", "context", "BY-1"]);
        expect(JSON.parse(context.stdout)).toMatchObject({
          task: { id: "BY-1", title: "Approved intent", description: "Original intent" },
        });
      }),
    90_000,
  );

  it.effect(
    "keeps linked Task Context independent from Change blocker resolutions",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        expect((yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"])).status).toBe(0);
        expect(
          runBuiltByWithInput(
            root,
            "Current Task description",
            {},
            "task",
            "create",
            "--title",
            "Current Task title",
            "--file",
            "-",
          ).status,
        ).toBe(0);
        yield* passTaskReviewFixture(root, "BY-1");
        writeFileSync(
          join(root, ".but-why", "config.json"),
          `${JSON.stringify(
            {
              idPrefix: "BY",
              prepare: { command: "true" },
              validation: { checks: [{ id: "test", command: "true" }] },
              review: { acceptance: { agentProfile: { scope: "global", name: "test" } } },
            },
            null,
            2,
          )}\n`,
        );
        commitButWhyConfigAndRecordDefault(root);
        const globalConfigPath = join(root, ".test-global-config.json");
        writeFileSync(
          globalConfigPath,
          `${JSON.stringify(
            {
              agentProfiles: {
                test: { agentRuntime: "pi", runtimeConfig: { model: "test/model" } },
              },
            },
            null,
            2,
          )}\n`,
        );

        const started = yield* runByInProcessEffect(
          root,
          ["change", "start", "--task", "BY-1"],
          undefined,
          { globalConfigPath },
        );
        expect(started.status).toBe(0);
        const changeId = (JSON.parse(started.stdout) as { change: { id: string } }).change.id;

        const raised = runBuiltByWithInput(
          root,
          "Unsafe implementation requires an operator decision.",
          {},
          "change",
          "blocker",
          "raise",
          changeId,
          "--file",
          "-",
        );
        expect(raised.status).toBe(0);
        const resolved = runBuiltByWithInput(
          root,
          "Continue with the approved Task intent.",
          {},
          "change",
          "blocker",
          "resolve",
          changeId,
          "--file",
          "-",
        );
        expect(resolved.status).toBe(0);

        const context = yield* runByInProcessEffect(root, ["task", "context", "BY-1"]);
        expect(context.status).toBe(0);
        expect(JSON.parse(context.stdout)).toEqual({
          task: {
            id: "BY-1",
            title: "Current Task title",
            description: "Current Task description",
          },
        });
      }),
    90_000,
  );

  it.effect(
    "preserves piped bytes, structured results, exit status, and stdout framing",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const initialized = yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"]);
        expect(initialized.status).toBe(0);

        const description = "Descripción exacta\n";
        const created = runBuiltByWithInput(
          root,
          description,
          {},
          "task",
          "create",
          "--title",
          "Piped input",
          "--file",
          "-",
        );

        expect(created.status).toBe(0);
        expect(created.stderr).toBe("");
        expectExactlyOneTrailingLineFeed(created.stdout);
        expect(JSON.parse(created.stdout)).toMatchObject({
          task: { id: "BY-1", title: "Piped input", state: "new" },
          context: { id: "BY-1", description },
        });

        const persisted = yield* runByInProcessEffect(root, ["task", "context", "BY-1"]);
        expect(persisted.status).toBe(0);
        expect(JSON.parse(persisted.stdout)).toMatchObject({
          task: { id: "BY-1", description },
        });

        const invalid = runBuiltByWithInput(
          root,
          Buffer.from([0xff]),
          {},
          "task",
          "create",
          "--title",
          "Invalid",
          "--file",
          "-",
        );

        expect(invalid.status).toBe(2);
        expect(invalid.stderr).toBe("");
        expectExactlyOneTrailingLineFeed(invalid.stdout);
        const invalidOutput = JSON.parse(invalid.stdout) as Record<string, unknown>;
        expect(invalidOutput).toMatchObject({
          error: { code: "invalid_description_encoding" },
        });
        expect(invalidOutput).not.toHaveProperty("task");
        expect(invalidOutput).not.toHaveProperty("context");
      }),
    90_000,
  );
});
