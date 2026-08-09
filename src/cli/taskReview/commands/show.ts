// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../../cliResults.js";
import {
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  success,
} from "../../../cliResults.js";
import { structuredValue } from "../../../output/structuredValue.js";
import { loadTaskReviewInspection } from "../../../task/loadTaskReviewInspection.js";
import type { TaskCommandEnvironment } from "../../task/taskCliSupport.js";

export type TaskReviewIdCommand = { readonly reviewId: string };

export const runShowCommand = (
  command: TaskReviewIdCommand,
  environment: TaskCommandEnvironment,
): Effect.Effect<CliResult> => {
  const loaded = loadTaskReviewInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));
  return loaded.inspection.getReviewById(command.reviewId).pipe(
    Effect.flatMap((review) =>
      review === undefined
        ? Effect.succeed(reviewNotFound(command.reviewId))
        : Effect.all({
            findings: loaded.inspection.findings(command.reviewId),
            toolingFailures: loaded.inspection.toolingFailures(command.reviewId),
            session: loaded.inspection.session(review.taskId, "task_review"),
            transcripts: loaded.inspection.transcripts(review.taskId),
          }).pipe(
            Effect.map(({ findings, toolingFailures, session, transcripts }) =>
              success({
                review: {
                  id: review.id,
                  taskId: review.taskId,
                  state: review.state,
                  outcome: review.outcome,
                  baseCommit: review.baseCommit,
                  createdAt: review.createdAt,
                  updatedAt: review.updatedAt,
                  proposal: {
                    title: review.proposal.title,
                    description: review.proposal.description,
                    dependencies: review.proposal.dependencies.map((dependency) => ({
                      taskId: dependency.taskId,
                      title: dependency.title,
                      state: dependency.state,
                    })),
                  },
                  policy: structuredValue(review.policy),
                  ...(session === undefined
                    ? {}
                    : {
                        session: {
                          producer: session.producer,
                          fingerprint: session.fingerprint,
                          sessionReference: session.sessionReference,
                        },
                      }),
                  ...(transcripts.length === 0
                    ? {}
                    : {
                        transcripts: transcripts.map((transcript) => ({
                          producer: transcript.producer,
                          piSessionId: transcript.piSessionId,
                          filePath: transcript.filePath,
                        })),
                      }),
                  ...(findings.length === 0 ? {} : { findings }),
                  ...(toolingFailures.length === 0 ? {} : { toolingFailures }),
                },
                ...(review.state === "complete" &&
                (review.outcome === "passed" || review.outcome === "blocked")
                  ? {
                      nextAction:
                        review.outcome === "passed"
                          ? `Task ${review.taskId} is approved.`
                          : `Fix the Findings, then run \`by task submit ${review.taskId}\`.`,
                    }
                  : review.state === "running"
                    ? {
                        nextAction: `Abandon with \`by task-review abandon ${review.id} --reason <reason>\` if its Submission process stopped.`,
                      }
                    : {}),
              }),
            ),
          ),
    ),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
  );
};

export const reviewNotFound = (reviewId: string): CliResult =>
  runtimeError({
    code: "review_not_found",
    message: `Task Review was not found: ${reviewId}`,
    details: { reviewId },
    help: ["Run `by task reviews <task-id>` to list Task Reviews."],
  });
