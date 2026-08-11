import { Effect } from "effect";
import type { ExecutionLock } from "../contracts/executionLock.js";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import type { ValidationRunAbandonmentPort } from "./validation/changeValidationPorts.js";
import type { SnapshotWorkspaceCleanup } from "./validation/snapshotWorkspaceCleanup.js";

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
      readonly cleanup: { readonly workspace: string };
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
  readonly persistence: ValidationRunAbandonmentPort;
  readonly executionLock: ExecutionLock;
  readonly workspaceCleanup: SnapshotWorkspaceCleanup;
}): AbandonValidationRun => ({
  abandon: (command) =>
    Effect.gen(function* () {
      const context = yield* input.persistence.getAbandonmentContext(command.validationRunId);
      if (context === undefined) return notFound(command.validationRunId);
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
    readonly persistence: ValidationRunAbandonmentPort;
    readonly workspaceCleanup: SnapshotWorkspaceCleanup;
  },
  command: { readonly validationRunId: string; readonly reason: string; readonly now: string },
): Effect.Effect<AbandonValidationRunResult, RepositoryStorageError> =>
  Effect.gen(function* () {
    const context = yield* input.persistence.getAbandonmentContext(command.validationRunId);
    if (context === undefined) return notFound(command.validationRunId);
    const run = yield* input.persistence.getRunById(command.validationRunId);
    if (run === undefined) return notFound(command.validationRunId);
    if (run.state === "complete") {
      return {
        ok: true,
        status: "already_complete",
        validationRunId: command.validationRunId,
      } as const;
    }

    const cleanupAttempt = yield* input.workspaceCleanup.cleanup({
      validationRunId: command.validationRunId,
      submittedSha: context.submittedSha,
      ...(context.worktreePath === undefined ? {} : { recordedWorktreePath: context.worktreePath }),
      ...(context.preNativeRefName === undefined
        ? {}
        : { preNativeRefName: context.preNativeRefName }),
    });
    const cleanup = { workspace: cleanupAttempt.workspace } as const;
    if (cleanup.workspace === "failed") {
      yield* input.persistence.recordToolingFailure({
        validationRunId: command.validationRunId,
        errorKind: "infrastructure_tooling_failed",
        operationName: "abandon_validation_run_cleanup",
        errorMessage: `${command.reason} Cleanup workspace=${cleanup.workspace}.${cleanupAttempt.errorMessage === undefined ? "" : ` ${cleanupAttempt.errorMessage}`}`,
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

const notFound = (validationRunId: string): AbandonValidationRunResult => ({
  ok: false,
  status: "not_found",
  validationRunId,
  cleanup: { workspace: "not_created" },
});
