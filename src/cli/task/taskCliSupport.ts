import { Effect } from "effect";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { TextInputStdin } from "../../cli/input/textInput.js";
import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
} from "../../cliResults.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { RepositoryOperationError } from "../../repositoryRuntime/repositoryOperation.js";
import { stderrSubmitProgress } from "../../submission/submissionProgress.js";
import {
  type LoadTaskReviewError,
  type TaskReviewRepositorySubmitResult,
  withTaskReviewInspectionUseCases,
  withTaskReviewRecoveryUseCases,
  withTaskReviewSubmissionUseCases,
} from "../../task/composition/loadTaskReviewUseCases.js";
import type { TaskReviewerOutput } from "../../task/review/taskReviewerOutput.js";
import type {
  TaskReviewInspectionUseCases,
  TaskReviewRecoveryUseCases,
  TaskReviewSubmissionUseCases,
} from "../../task/review/taskReviewUseCases.js";
import type { TaskSimplificationAdviceOutput } from "../../task/review/taskSimplificationAdviceOutput.js";
import type { TaskRecord } from "../../task/task.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { CancellationUseCases } from "../../taskChange/cancelTaskChange.js";

export type TaskIdCommand = { readonly taskId: string };

export type TaskCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly globalConfigPath?: string;
  readonly taskReviewInspectionUseCases?: TaskReviewInspectionUseCases;
  readonly taskReviewRecoveryUseCases?: TaskReviewRecoveryUseCases;
  readonly taskReviewSubmissionUseCases?: TaskReviewSubmissionUseCases;
  readonly taskReviewerAgentRuntime?: ReviewerAgentRuntime<TaskReviewerOutput>;
  readonly underengineerAgentRuntime?: ReviewerAgentRuntime<TaskSimplificationAdviceOutput>;
  readonly cancellationUseCases?: CancellationUseCases;
  readonly writeStderr?: (message: string) => void;
};

export const withTasks = (
  environment: TaskCommandEnvironment,
  use: (cwd: string) => Effect.Effect<CliResult, RepositoryOperationError>,
): Effect.Effect<CliResult> =>
  use(environment.cwd).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        "code" in error
          ? repoStateLoadError(error)
          : error._tag === "RepositoryOperationStorageError"
            ? repositoryStorageErrorResult(error.error, error.idPrefix)
            : repositoryStorageErrorResult(error),
      ),
    ),
  );

export const withTaskReviewInspection = (
  environment: TaskCommandEnvironment,
  use: (reviews: TaskReviewInspectionUseCases) => Effect.Effect<CliResult, RepositoryStorageError>,
): Effect.Effect<CliResult> => {
  const injected = environment.taskReviewInspectionUseCases;
  const program =
    injected === undefined
      ? withTaskReviewInspectionUseCases(taskRepositoryInput(environment), use).pipe(
          Effect.map((result) =>
            result.ok ? result.value : taskReviewLoadErrorResult(result.error),
          ),
        )
      : use(injected);
  return catchTaskReviewStorageError(program);
};

export const withTaskReviewRecovery = (
  environment: TaskCommandEnvironment,
  use: (reviews: TaskReviewRecoveryUseCases) => Effect.Effect<CliResult, RepositoryStorageError>,
): Effect.Effect<CliResult> => {
  const injected = environment.taskReviewRecoveryUseCases;
  const program =
    injected === undefined
      ? withTaskReviewRecoveryUseCases(taskRepositoryInput(environment), use).pipe(
          Effect.map((result) =>
            result.ok ? result.value : taskReviewLoadErrorResult(result.error),
          ),
        )
      : use(injected);
  return catchTaskReviewStorageError(program);
};

export const withTaskReviewSubmission = (
  environment: TaskCommandEnvironment,
  taskId: PublicTaskId,
  now: string,
  use: (result: TaskReviewRepositorySubmitResult) => Effect.Effect<CliResult>,
): Effect.Effect<CliResult> => {
  const program =
    environment.taskReviewSubmissionUseCases === undefined
      ? withTaskReviewSubmissionUseCases(
          {
            ...taskRepositoryInput(environment),
            globalConfigPath: environment.globalConfigPath ?? "",
            ...(environment.taskReviewerAgentRuntime === undefined
              ? {}
              : { reviewerRuntime: environment.taskReviewerAgentRuntime }),
            ...(environment.underengineerAgentRuntime === undefined
              ? {}
              : { underengineerRuntime: environment.underengineerAgentRuntime }),
            ...(environment.writeStderr === undefined
              ? {}
              : { progress: stderrSubmitProgress(environment.writeStderr) }),
            taskId,
            now,
          },
          use,
        ).pipe(
          Effect.map((result) =>
            result.ok ? result.value : taskReviewLoadErrorResult(result.error),
          ),
        )
      : environment.taskReviewSubmissionUseCases.submit(taskId, now).pipe(Effect.flatMap(use));
  return program.pipe(
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
  );
};

const catchTaskReviewStorageError = (
  program: Effect.Effect<CliResult, RepositoryStorageError>,
): Effect.Effect<CliResult> =>
  program.pipe(Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))));

const taskRepositoryInput = (environment: TaskCommandEnvironment) => ({
  cwd: environment.cwd,
});

const taskReviewLoadErrorResult = (error: LoadTaskReviewError): CliResult =>
  error.code === "task_review_config_invalid"
    ? runtimeError({
        code: error.code,
        message: error.message,
        help: ["Fix the reported Agent Profile configuration, then retry."],
      })
    : repoStateLoadError(error);

export const taskMutationView = (task: TaskRecord) => ({
  id: task.id,
  title: task.title,
  state: task.state,
  ...(task.cancelReason === null ? {} : { cancelReason: task.cancelReason }),
  prerequisites: task.prerequisites,
  dependents: task.dependents,
  change: null,
});

export const taskNotFound = (taskId: string): CliResult =>
  runtimeError({
    code: "task_not_found",
    message: `Task was not found: ${taskId}`,
    details: { taskId },
    help: ["Run `by task list --all --limit all` to see known Tasks."],
  });
