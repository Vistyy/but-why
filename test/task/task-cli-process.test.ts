import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
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
    "renames a New Task through the packaged CLI boundary",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        expect((yield* runByInProcessEffect(root, ["init", "--id-prefix", "BY"])).status).toBe(0);
        expect(
          runBuiltByWithInput(
            root,
            "Task description",
            {},
            "task",
            "create",
            "--title",
            "Original title",
            "--file",
            "-",
          ).status,
        ).toBe(0);

        const renamed = runBuiltByWithEnv(
          root,
          {},
          "task",
          "rename",
          "BY-1",
          "--title",
          "  Renamed title  ",
        );
        expect(renamed.status).toBe(0);
        expect(renamed.stderr).toBe("");
        expect(JSON.parse(renamed.stdout)).toEqual({
          task: { id: "BY-1", title: "Renamed title", state: "new", noOp: false },
        });

        const noOp = runBuiltByWithEnv(
          root,
          {},
          "task",
          "rename",
          "BY-1",
          "--title",
          "Renamed title",
        );
        expect(noOp.status).toBe(0);
        expect(JSON.parse(noOp.stdout)).toEqual({
          task: { id: "BY-1", title: "Renamed title", state: "new", noOp: true },
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
