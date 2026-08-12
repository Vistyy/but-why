import { Effect } from "effect";
import { loadChangeTaskProjection } from "../../../change/composition/loadChangeInspection.js";
import type { CliResult } from "../../../cliResults.js";
import { stateStoreUnavailable, success } from "../../../cliResults.js";
import { parseCliTaskIdValue } from "../../../cliTaskId.js";
import {
  resolveTaskId,
  type TaskCommandEnvironment,
  type TaskIdCommand,
  taskNotFound,
  withTaskReviewInspection,
  withTasks,
} from "../taskCliSupport.js";

export const runTaskShowCommand = (
  command: TaskIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const parsed = parseCliTaskIdValue(command.taskId);
  if (!parsed.ok) return Effect.succeed(parsed.result);
  return withTasks(environment, (tasks) => {
    const taskId = resolveTaskId(tasks, parsed.taskId);
    if (!taskId.ok) return Effect.succeed(taskId.result);
    return Effect.gen(function* () {
      const task = yield* tasks.getTaskForInspection(taskId.taskId);
      if (task === undefined) return taskNotFound(taskId.taskId);
      const change =
        environment.taskUseCases === undefined
          ? loadChangeTaskProjection({ cwd: environment.cwd })
          : undefined;
      if (change !== undefined && !change.ok) return stateStoreUnavailable(tasks.taskPrefix);
      const projection = change === undefined ? null : yield* change.operation(taskId.taskId);
      return yield* withTaskReviewInspection(environment, (reviews) =>
        Effect.gen(function* () {
          const review = yield* reviews.getLatestForTask(taskId.taskId);
          const proposalCurrent =
            review === undefined ? undefined : yield* reviews.proposalIsCurrent(review);
          return success({
            task: {
              id: task.id,
              title: task.title,
              state: task.state,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
              ...(task.cancelReason === null ? {} : { cancelReason: task.cancelReason }),
              prerequisites: task.prerequisites,
              dependents: task.dependents,
              change: projection,
              review:
                review === undefined
                  ? null
                  : {
                      id: review.id,
                      state: review.state,
                      outcome: review.outcome,
                      proposalCurrent: proposalCurrent ?? null,
                      findingCount: review.findings.length,
                      findings: review.findings,
                      workspaceCleanup: review.workspaceCleanup,
                      toolingFailure:
                        review.toolingFailure === null
                          ? null
                          : {
                              operation: review.toolingFailure.operation,
                              message: review.toolingFailure.message,
                            },
                    },
            },
            contextCommand: `by task context ${task.id}`,
            ...(review === undefined
              ? task.state === "new"
                ? { help: [`Run \`by task submit ${task.id}\` to submit this Task for review.`] }
                : task.state === "todo" && projection === null
                  ? {
                      help: [
                        `Run \`by task submit ${task.id} --rerun\` to reconsider the unchanged approved proposal.`,
                        `Run \`by task revise ${task.id}\` before changing approved Task intent.`,
                      ],
                    }
                  : {}
              : {
                  reviewCommand: `by task-review show ${review.id}`,
                  ...(task.state === "todo" && projection === null && review.state !== "running"
                    ? {
                        help: [
                          `Run \`by task submit ${task.id} --rerun\` to reconsider the unchanged approved proposal.`,
                          `Run \`by task revise ${task.id}\` before changing approved Task intent.`,
                        ],
                      }
                    : {}),
                }),
          });
        }),
      );
    });
  });
};
