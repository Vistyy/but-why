import { Effect } from "effect";
import { loadAbandonValidationRun } from "../../change/loadAbandonValidationRun.js";
import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  success,
} from "../../cliResults.js";
export type ValidationRunCommandEnvironment = { readonly cwd: string; readonly now: () => Date };
const notFound = (id: string): CliResult =>
  runtimeError({
    code: "validation_run_not_found",
    message: `Validation Run was not found: ${id}`,
    details: { validationRunId: id },
    help: ["Run `by change show <change-id>` to inspect known Candidates and Validation Runs."],
  });
export const runAbandonCommand = (
  command: { readonly validationRunId: string; readonly reason: string },
  environment: ValidationRunCommandEnvironment,
): Effect.Effect<CliResult> => {
  if (command.reason.trim().length === 0)
    return Effect.succeed({
      exitCode: 2,
      stdout: {
        error: {
          code: "empty_reason",
          message: "Validation Run abandonment requires a non-empty reason.",
          help: ["Provide a non-empty value for `--reason`."],
        },
      },
    });
  const loaded = loadAbandonValidationRun({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));
  return loaded.abandon.abandon({ ...command, now: environment.now().toISOString() }).pipe(
    Effect.map((result) =>
      result.ok
        ? success(result)
        : result.status === "not_found"
          ? notFound(command.validationRunId)
          : runtimeError({
              code:
                result.status === "submission_in_progress"
                  ? result.status
                  : "validation_run_cleanup_failed",
              message:
                result.status === "submission_in_progress"
                  ? "Another Submission, cancellation, or abandonment already owns this Change."
                  : "Validation Run resources could not be cleaned up, so abandonment is incomplete.",
              details: result,
              help: [
                "Stop every process, repair the reported resources, then retry Validation Run Abandon.",
              ],
            }),
    ),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
  );
};
