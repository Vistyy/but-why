import { Effect } from "effect";
import type { ReviewerAgentRuntime } from "../../agent/reviewerAgentRuntime.js";
import type { CancellationUseCases } from "../../change/cancelChange.js";
import type { TextInputStdin } from "../../cli/input/textInput.js";
import type { CliResult } from "../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
} from "../../cliResults.js";
import { taskIdResolutionError } from "../../cliTaskId.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import type { ReviewerOutput } from "../../contracts/reviewerOutput.js";
import { resolveRepositoryTaskPrefix } from "../../repositoryRuntime/repositoryRuntime.js";
import {
  type LoadTaskReviewError,
  withTaskReviewReadUseCases,
  withTaskReviewUseCases,
} from "../../task/composition/loadTaskReviewUseCases.js";
import { withTaskUseCases } from "../../task/composition/loadTaskUseCases.js";
import type {
  TaskReviewReadUseCases,
  TaskReviewUseCases,
} from "../../task/review/taskReviewUseCases.js";
import type { TaskRecord } from "../../task/task.js";
import type { PublicTaskId } from "../../task/taskId.js";
import type { TaskUseCases } from "../../task/taskUseCases.js";

export type TaskCommandEnvironment = {
  readonly cwd: string;
  readonly now: () => Date;
  readonly stdin: TextInputStdin;
  readonly globalConfigPath?: string;
  readonly taskUseCases?: TaskUseCases;
  readonly taskReviewReadUseCases?: TaskReviewReadUseCases;
  readonly taskReviewUseCases?: TaskReviewUseCases;
  readonly reviewerAgentRuntime?: ReviewerAgentRuntime<ReviewerOutput>;
  readonly cancellationUseCases?: CancellationUseCases;
};

export const withTasks = (
  environment: TaskCommandEnvironment,
  use: (tasks: TaskUseCases) => Effect.Effect<CliResult, RepositoryStorageError>,
): Effect.Effect<CliResult> => {
  const program =
    environment.taskUseCases === undefined
      ? withTaskUseCases({ cwd: environment.cwd }, use).pipe(
          Effect.map((result) => (result.ok ? result.value : repoStateLoadError(result.error))),
        )
      : use(environment.taskUseCases);

  return program.pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        repositoryStorageErrorResult(error, resolveRepositoryTaskPrefix(environment.cwd)),
      ),
    ),
  );
};

export const withTaskReviewReads = (
  environment: TaskCommandEnvironment,
  use: (reviews: TaskReviewReadUseCases) => Effect.Effect<CliResult, RepositoryStorageError>,
): Effect.Effect<CliResult> => {
  const injected = environment.taskReviewReadUseCases ?? environment.taskReviewUseCases;
  const program =
    injected === undefined
      ? withTaskReviewReadUseCases({ cwd: environment.cwd }, use).pipe(
          Effect.map((result) =>
            result.ok ? result.value : taskReviewLoadErrorResult(result.error),
          ),
        )
      : use(injected);
  return program.pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        repositoryStorageErrorResult(error, resolveRepositoryTaskPrefix(environment.cwd)),
      ),
    ),
  );
};

export const withTaskReviews = (
  environment: TaskCommandEnvironment,
  use: (reviews: TaskReviewUseCases) => Effect.Effect<CliResult, RepositoryStorageError>,
): Effect.Effect<CliResult> => {
  const program =
    environment.taskReviewUseCases === undefined
      ? withTaskReviewUseCases(
          {
            cwd: environment.cwd,
            globalConfigPath: environment.globalConfigPath ?? "",
            ...(environment.reviewerAgentRuntime === undefined
              ? {}
              : { reviewerRuntime: environment.reviewerAgentRuntime }),
          },
          use,
        ).pipe(
          Effect.map((result) =>
            result.ok ? result.value : taskReviewLoadErrorResult(result.error),
          ),
        )
      : use(environment.taskReviewUseCases);
  return program.pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        repositoryStorageErrorResult(error, resolveRepositoryTaskPrefix(environment.cwd)),
      ),
    ),
  );
};

const taskReviewLoadErrorResult = (error: LoadTaskReviewError): CliResult =>
  error.code === "task_review_config_invalid"
    ? runtimeError({
        code: error.code,
        message: error.message,
        help: ["Fix the reported Agent Profile configuration, then retry."],
      })
    : repoStateLoadError(error);

export type ResolvedTaskIdResult =
  | {
      readonly ok: true;
      readonly tasks: TaskUseCases;
      readonly taskId: PublicTaskId;
    }
  | {
      readonly ok: false;
      readonly result: CliResult;
    };

export const resolveTaskId = (tasks: TaskUseCases, taskId: PublicTaskId): ResolvedTaskIdResult => {
  const resolvedTaskId = tasks.resolveTaskId(taskId);
  if (!resolvedTaskId.ok) {
    return { ok: false, result: taskIdResolutionError(resolvedTaskId) };
  }
  return { ok: true, tasks, taskId: resolvedTaskId.taskId };
};

export const taskMutationView = (task: TaskRecord) => ({
  id: task.id,
  title: task.title,
  state: task.state,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
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
