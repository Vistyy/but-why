import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runByInProcessEffect } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Implementation Blocker recording input", () => {
  it.effect.each(["raise", "resolve"] as const)(
    "documents shared recording input for Blocker %s in generated help",
    (action) =>
      Effect.gen(function* () {
        const result = yield* runByInProcessEffect(createTestWorkspace(), [
          "--json",
          "change",
          "blocker",
          action,
          "--help",
        ]);

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const help = (JSON.parse(result.stdout) as { readonly help: string }).help;
        expect(help).toContain("regular UTF-8 text file path");
        expect(help).toContain("standard input");
      }),
  );

  it.effect.each(["raise", "resolve"] as const)("applies the shared text policy to %s", (action) =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      mkdirSync(join(root, "directory"));
      writeFileSync(join(root, "invalid.bin"), Buffer.from([0xff]));
      writeFileSync(join(root, "blank.txt"), " \n\t");
      writeFileSync(join(root, "large.txt"), "x".repeat(256 * 1024 + 1));

      const cases = [
        ["directory", "decision_file_unreadable"],
        ["invalid.bin", "invalid_decision_encoding"],
        ["blank.txt", "empty_decision_file"],
        ["large.txt", "decision_file_too_large"],
        ["-", "stdin_is_terminal"],
      ] as const;

      for (const [file, code] of cases) {
        const result = yield* runByInProcessEffect(root, [
          "change",
          "blocker",
          action,
          "change-id",
          "--file",
          file,
        ]);

        expect(result.status, `${action} ${file}`).toBe(1);
        expect(result.stderr, `${action} ${file}`).toBe("");
        expect(result.stdout, `${action} ${file}`).toContain(`code: ${code}`);
      }
    }),
  );
});
