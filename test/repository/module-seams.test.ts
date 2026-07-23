import { describe, expect, it } from "vitest";

import { runtimeError, success, usageError } from "../../src/cliResults.js";
describe("module seams", () => {
  it("constructs shared CLI result objects without serialization concerns", () => {
    expect(success({ ok: true })).toEqual({ exitCode: 0, stdout: { ok: true } });
    expect(
      usageError({ code: "bad_args", message: "Bad arguments.", help: ["Fix the command."] }),
    ).toEqual({
      exitCode: 2,
      stdout: {
        error: { code: "bad_args", message: "Bad arguments." },
        help: ["Fix the command."],
      },
    });
    expect(
      runtimeError({ code: "failed", message: "Command failed.", help: ["Try again."] }),
    ).toEqual({
      exitCode: 1,
      stdout: { error: { code: "failed", message: "Command failed." }, help: ["Try again."] },
    });
  });
});
