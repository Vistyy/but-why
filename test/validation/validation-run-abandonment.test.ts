import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { openAbandonValidationRun } from "../../src/change/abandonValidationRun.js";
import type {
  CandidateValidationRunAbandonmentContext,
  CandidateValidationRunRecord,
} from "../../src/change/candidateValidation/candidateValidationRunStore.js";
import type { ValidationRunAbandonmentPort } from "../../src/change/validation/changeValidationPorts.js";
import type { ExecutionLock } from "../../src/contracts/executionLock.js";

const validationRunId = "run-1";
const changeId = "change-1";
const worktreePath = "/linked-main-worktrees/but-why/validation-runs/run-1";

const runningRun: CandidateValidationRunRecord = {
  id: validationRunId,
  candidateId: "candidate-1",
  policy: { checks: [], copyFiles: [] },
  implementationDecisions: [],
  state: "running",
  outcome: null,
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z",
};

const abandonmentContext: CandidateValidationRunAbandonmentContext = {
  validationRunId,
  changeId,
  candidateId: runningRun.candidateId,
  submittedSha: "head-sha",
  worktreePath,
  cleanupWorkspace: "not_created",
};

const passThroughLock: ExecutionLock = {
  withLock: ({ effect }) => effect,
};

const persistenceFor = (overrides: {
  readonly recordToolingFailure?: ValidationRunAbandonmentPort["recordToolingFailure"];
  readonly abandon?: ValidationRunAbandonmentPort["abandon"];
}): ValidationRunAbandonmentPort => ({
  getAbandonmentContext: () => Effect.succeed(abandonmentContext),
  getRunById: () => Effect.succeed(runningRun),
  recordToolingFailure: overrides.recordToolingFailure ?? (() => Effect.succeed(undefined)),
  abandon: overrides.abandon ?? (() => Effect.succeed(undefined)),
});

describe("Validation Run abandonment cleanup seam", () => {
  it.effect("cleans the exact persisted workspace through the injected Adapter", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const abandoned = yield* openAbandonValidationRun({
        persistence: persistenceFor({
          abandon: () => Effect.sync(() => calls.push("abandon")),
        }),
        executionLock: passThroughLock,
        workspaceCleanup: {
          cleanup: (input) =>
            Effect.sync(() => {
              calls.push(
                `cleanup:${input.validationRunId}:${input.submittedSha}:${input.recordedWorktreePath}`,
              );
              return { workspace: "removed" as const };
            }),
        },
      }).abandon({
        validationRunId,
        reason: "The validation process terminated.",
        now: "2026-07-31T10:05:00.000Z",
      });

      expect(abandoned).toEqual({ ok: true, status: "abandoned", validationRunId });
      expect(calls).toEqual([`cleanup:${validationRunId}:head-sha:${worktreePath}`, "abandon"]);
    }),
  );

  it.effect("retains a cleanup failure through the injected Adapter", () =>
    Effect.gen(function* () {
      const failures: string[] = [];
      let abandoned = false;
      const result = yield* openAbandonValidationRun({
        persistence: persistenceFor({
          recordToolingFailure: (input) => Effect.sync(() => failures.push(input.errorMessage)),
          abandon: () =>
            Effect.sync(() => {
              abandoned = true;
            }),
        }),
        executionLock: passThroughLock,
        workspaceCleanup: {
          cleanup: () => Effect.succeed({ workspace: "failed" }),
        },
      }).abandon({
        validationRunId,
        reason: "The validation process terminated.",
        now: "2026-07-31T10:05:00.000Z",
      });

      expect(result).toEqual({
        ok: false,
        status: "cleanup_failed",
        validationRunId,
        changeId,
        cleanup: { workspace: "failed" },
      });
      expect(failures).toEqual(["The validation process terminated. Cleanup workspace=failed."]);
      expect(abandoned).toBe(false);
    }),
  );
});
