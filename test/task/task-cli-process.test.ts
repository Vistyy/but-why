import { expect, it } from "@effect/vitest";
import { decode } from "@toon-format/toon";
import { Effect } from "effect";
import { describe } from "vitest";

import { createGitRepo, runBuiltByWithInput, runByInProcessEffect } from "../support/by-cli.js";

const expectExactlyOneTrailingLineFeed = (stdout: string): void => {
  const bytes = Buffer.from(stdout, "utf8");
  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.at(-2)).not.toBe(0x0a);
};

describe("by task CLI process boundary", () => {
  it.effect(
    "preserves piped bytes, structured results, exit status, and stdout framing",
    () =>
      Effect.gen(function* () {
        const root = createGitRepo();
        const initialized = yield* runByInProcessEffect(root, ["init", "--task-prefix", "BY"]);
        expect(initialized.status).toBe(0);

        const description = "Descripción exacta\n";
        const created = runBuiltByWithInput(
          root,
          description,
          {},
          "--json",
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
        expect(decode(persisted.stdout)).toMatchObject({
          task: { id: "BY-1", description },
        });

        const invalid = runBuiltByWithInput(
          root,
          Buffer.from([0xff]),
          {},
          "--json",
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
