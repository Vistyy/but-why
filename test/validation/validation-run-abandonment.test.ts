import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import {
  openAbandonValidationRun,
  type AbandonValidationPersistence,
} from "../../src/change/abandonValidationRun.js";
import type { ExecutionLock } from "../../src/contracts/executionLock.js";
import type {
  CandidateValidationRunAbandonmentContext,
  CandidateValidationRunRecord,
} from "../../src/change/candidateValidation/candidateValidationRunStore.js";

const validationRunId = "run-1";
const changeId = "change-1";
const tempRefName = "refs/but-why/validation-runs/run-1/validation";
const worktreePath = "/linked-main/.sandcastle/worktrees/validation-run";

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
  tempRefName,
  worktreePath,
  cleanupWorktree: "not_created",
  cleanupTempRef: "not_created",
};

const passThroughLock: ExecutionLock = {
  withLock: ({ effect }) => effect,
};

const persistenceFor = (overrides: {
  readonly context?: CandidateValidationRunAbandonmentContext;
  readonly recordToolingFailure?: AbandonValidationPersistence["recordToolingFailure"];
  readonly abandon?: AbandonValidationPersistence["abandon"];
}): AbandonValidationPersistence => ({
  getAbandonmentContext: () => Effect.succeed(overrides.context ?? abandonmentContext),
  getRunById: () => Effect.succeed(runningRun),
  recordToolingFailure: overrides.recordToolingFailure ?? (() => Effect.succeed(undefined)),
  abandon: overrides.abandon ?? (() => Effect.succeed(undefined)),
});

describe("Validation Run abandonment cleanup seam", () => {
  it.effect("cleans the exact persisted workspace through injected Adapters", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const abandoned = yield* openAbandonValidationRun({
        persistence: persistenceFor({
          abandon: () => Effect.sync(() => calls.push("abandon")),
        }),
        executionLock: passThroughLock,
        workspaceCleanup: {
          tempRefName: () => tempRefName,
          removeWorktree: (path) => {
            calls.push(`worktree:${path}`);
            return true;
          },
          deleteTempRef: (ref) => {
            calls.push(`temp-ref:${ref}`);
            return "removed";
          },
        },
      }).abandon({
        validationRunId,
        reason: "The validation process terminated.",
        now: "2026-07-31T10:05:00.000Z",
      });

      expect(abandoned).toEqual({ ok: true, status: "abandoned", validationRunId });
      expect(calls).toEqual([`temp-ref:${tempRefName}`, `worktree:${worktreePath}`, "abandon"]);
    }),
  );

  it.effect("does not guess a workspace path for a legacy run", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const { worktreePath: _worktreePath, ...legacyContext } = abandonmentContext;
      const result = yield* openAbandonValidationRun({
        persistence: persistenceFor({
          context: {
            ...legacyContext,
            cleanupWorktree: null,
          },
          recordToolingFailure: (input) => Effect.sync(() => calls.push(input.errorMessage)),
        }),
        executionLock: passThroughLock,
        workspaceCleanup: {
          tempRefName: () => tempRefName,
          removeWorktree: () => {
            calls.push("wrong-worktree");
            return true;
          },
          deleteTempRef: () => "removed",
        },
      }).abandon({
        validationRunId,
        reason: "The validation process terminated.",
        now: "2026-07-31T10:05:00.000Z",
      });

      expect(result).toMatchObject({
        ok: false,
        status: "cleanup_failed",
        cleanup: { worktree: "failed", tempRef: "removed" },
      });
      expect(calls).toEqual([
        "The validation process terminated. Cleanup worktree=failed; temporary ref=removed. Validation Workspace path was not recorded.",
      ]);
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
          tempRefName: () => tempRefName,
          removeWorktree: () => false,
          deleteTempRef: () => "removed",
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
        cleanup: { worktree: "failed", tempRef: "removed" },
      });
      expect(failures).toEqual([
        "The validation process terminated. Cleanup worktree=failed; temporary ref=removed.",
      ]);
      expect(abandoned).toBe(false);
    }),
  );
});
