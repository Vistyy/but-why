import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { runByInProcessEffect } from "../support/by-cli.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

describe("Implementation Blocker recording input", () => {
  it.effect.each(["raise", "resolve"] as const)("applies the shared text policy to %s", (action) =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      mkdirSync(join(root, "directory"));
      writeFileSync(join(root, "invalid.bin"), Buffer.from([0xff]));
      writeFileSync(join(root, "blank.txt"), " \n\t");
      writeFileSync(join(root, "large.txt"), "x".repeat(256 * 1024 + 1));

      const cases = [
        ["directory", "blocker_input_unreadable"],
        ["invalid.bin", "invalid_blocker_encoding"],
        ["blank.txt", "empty_blocker"],
        ["large.txt", "blocker_input_too_large"],
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

        expect(result.status, `${action} ${file}`).toBe(2);
        expect(result.stderr, `${action} ${file}`).toBe("");
        expect(result.stdout, `${action} ${file}`).toContain(`code: ${code}`);
      }
    }),
  );
});
