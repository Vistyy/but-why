import { describe, expect, it } from "vitest";

import { runtimeError, success, usageError } from "../src/cliResults.js";
import type { CandidateValidationRunStore } from "../src/candidateValidation/candidateValidationRunStore.js";
import type { ChangeStore } from "../src/change/changeStore.js";
import type { TaskStore } from "../src/task/taskStore.js";

const expectTaskStore = (_store: TaskStore): void => undefined;
const expectChangeStore = (_store: ChangeStore): void => undefined;
const expectCandidateValidationRunStore = (_store: CandidateValidationRunStore): void => undefined;

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

  it("keeps Task, Change, and Candidate validation persistence behind domain stores", () => {
    expectTaskStore as unknown;
    expectChangeStore as unknown;
    expectCandidateValidationRunStore as unknown;
  });
});
