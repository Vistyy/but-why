// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import { success } from "../../../cliResults.js";
import { parseCliTaskIdValue, taskIdResolutionError } from "../../../cliTaskId.js";
import { inspectTaskForInspection } from "../../../taskChange/composition/taskInspection.js";
import {
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
  return withTasks(environment, (cwd) =>
    Effect.flatMap(inspectTaskForInspection(cwd, parsed.taskId), (inspection) => {
      if (!inspection.ok) return Effect.succeed(taskIdResolutionError(inspection.error));
      const { task, change: projection } = inspection.value;
      if (task === undefined) return Effect.succeed(taskNotFound(parsed.taskId));
      return withTaskReviewInspection(environment, (reviews) =>
        Effect.gen(function* () {
          const review = yield* reviews.getLatestForTask(parsed.taskId);
          const simplificationAdvice = yield* reviews.getCompletedSimplificationAdvice(
            parsed.taskId,
          );
          const proposalCurrent =
            review === undefined ? undefined : yield* reviews.proposalIsCurrent(review);
          return success({
            task: {
              id: task.id,
              title: task.title,
              state: task.state,
              ...(task.cancelReason === null ? {} : { cancelReason: task.cancelReason }),
              prerequisites: task.prerequisites,
              dependents: task.dependents,
              change: projection,
              ...(simplificationAdvice === undefined ? {} : { simplificationAdvice }),
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
                        `Run \`by task revise ${task.id}\` before changing approved Task intent.`,
                      ],
                    }
                  : {}
              : {
                  reviewCommand: `by task-review show ${review.id}`,
                  ...(task.state === "todo" && projection === null
                    ? {
                        help: [
                          `Run \`by task revise ${task.id}\` before changing approved Task intent.`,
                        ],
                      }
                    : {}),
                }),
          });
        }),
      );
    }),
  );
};
