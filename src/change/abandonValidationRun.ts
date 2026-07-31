import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { SqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import type { ChangeValidationPersistence } from "./validation/changeValidationPersistence.js";
import {
  deleteValidationTempRef,
  expectedSandcastleWorktreePath,
  removeValidationWorktree,
  validationTempRefName,
} from "./validation/validationGitGlue.js";

export type AbandonValidationRunResult =
  | {
      readonly ok: true;
      readonly status: "abandoned" | "already_complete";
      readonly validationRunId: string;
    }
  | {
      readonly ok: false;
      readonly status: "not_found" | "cleanup_failed";
      readonly validationRunId: string;
      readonly changeId?: string;
      readonly cleanup: { readonly worktree: string; readonly tempRef: string };
    }
  | {
      readonly ok: false;
      readonly status: "submission_in_progress";
      readonly validationRunId: string;
      readonly changeId: string;
    };

export type AbandonValidationRun = {
  readonly abandon: (input: {
    readonly validationRunId: string;
    readonly reason: string;
    readonly now: string;
  }) => Effect.Effect<AbandonValidationRunResult, RepositoryStorageError>;
};

export const openAbandonValidationRun = (input: {
  readonly persistence: ChangeValidationPersistence;
  readonly executionLock: SqliteExecutionLock;
  readonly repoRoot: string;
}): AbandonValidationRun => ({
  abandon: (command) =>
    Effect.gen(function* () {
      const context = yield* input.persistence.getAbandonmentContext(command.validationRunId);
      if (context === undefined) {
        return {
          ok: false,
          status: "not_found",
          validationRunId: command.validationRunId,
          cleanup: { worktree: "not_created", tempRef: "not_created" },
        } as const;
      }
      return yield* input.executionLock
        .withLock({
          owner: "change_submission",
          key: context.changeId,
          effect: abandonWhileLocked(input, command),
        })
        .pipe(
          Effect.catchTag("ExecutionLockUnavailable", () =>
            input.persistence.getRunById(command.validationRunId).pipe(
              Effect.map((run) =>
                run?.state === "complete"
                  ? ({
                      ok: true,
                      status: "already_complete",
                      validationRunId: command.validationRunId,
                    } as const)
                  : ({
                      ok: false,
                      status: "submission_in_progress",
                      validationRunId: command.validationRunId,
                      changeId: context.changeId,
                    } as const),
              ),
            ),
          ),
        );
    }),
});

const abandonWhileLocked = (
  input: {
    readonly persistence: ChangeValidationPersistence;
    readonly repoRoot: string;
  },
  command: { readonly validationRunId: string; readonly reason: string; readonly now: string },
): Effect.Effect<AbandonValidationRunResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const context = yield* input.persistence.getAbandonmentContext(command.validationRunId);
    if (context === undefined) {
      return {
        ok: false,
        status: "not_found",
        validationRunId: command.validationRunId,
        cleanup: { worktree: "not_created", tempRef: "not_created" },
      } as const;
    }
    const run = yield* input.persistence.getRunById(command.validationRunId);
    if (run === undefined) {
      return {
        ok: false,
        status: "not_found",
        validationRunId: command.validationRunId,
        cleanup: { worktree: "not_created", tempRef: "not_created" },
      } as const;
    }
    if (run.state === "complete") {
      return {
        ok: true,
        status: "already_complete",
        validationRunId: command.validationRunId,
      } as const;
    }

    const tempRefName = context.tempRefName ?? validationTempRefName(command.validationRunId);
    const worktreePath =
      context.worktreePath ?? expectedSandcastleWorktreePath(input.repoRoot, tempRefName);
    const worktree =
      context.cleanupWorktree === "removed"
        ? "removed"
        : removeValidationWorktree(input.repoRoot, worktreePath)
          ? "removed"
          : "failed";
    const tempRef =
      context.cleanupTempRef === "removed"
        ? "removed"
        : deleteValidationTempRef(input.repoRoot, tempRefName);
    const cleanup = { worktree, tempRef } as const;
    if (worktree === "failed" || tempRef === "failed") {
      yield* input.persistence.recordToolingFailure({
        validationRunId: command.validationRunId,
        errorKind: "infrastructure_tooling_failed",
        operationName: "abandon_validation_run_cleanup",
        errorMessage: `${command.reason} Cleanup worktree=${worktree}; temporary ref=${tempRef}.`,
        now: command.now,
      });
      return {
        ok: false,
        status: "cleanup_failed",
        validationRunId: command.validationRunId,
        changeId: context.changeId,
        cleanup,
      } as const;
    }

    yield* input.persistence.abandon({
      validationRunId: command.validationRunId,
      errorKind: "infrastructure_tooling_failed",
      operationName: "validation_run_abandonment",
      errorMessage: command.reason,
      now: command.now,
    });
    return { ok: true, status: "abandoned", validationRunId: command.validationRunId } as const;
  });
