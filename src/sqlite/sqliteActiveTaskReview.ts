import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

import { type PublicTaskId, storedPublicTaskId } from "../task/taskId.js";
import { decodePersisted, decodeStoredString } from "./sqliteTaskReadModel.js";

type DecodedActiveTaskReview = {
  readonly reviewId: string;
  readonly taskId: PublicTaskId;
};

export const readValidatedActiveTaskReviewForTask = (
  sql: SqlClient.SqlClient,
  taskId: PublicTaskId,
  operationName: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly markerTaskId: unknown;
      readonly reviewId: unknown;
      readonly reviewTaskId: unknown;
      readonly reviewState: unknown;
      readonly reviewOutcome: unknown;
    }>`
      SELECT active.task_id AS markerTaskId, active.review_id AS reviewId,
        review.task_id AS reviewTaskId, review.state AS reviewState,
        review.outcome AS reviewOutcome
      FROM active_task_reviews AS active
      LEFT JOIN task_reviews AS review ON review.id = active.review_id
      WHERE active.task_id = ${taskId} OR review.task_id = ${taskId}
    `;
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) {
      return yield* decodePersisted(operationName, () => {
        throw new Error(`Task ${taskId} has multiple Active Task Review relationships`);
      });
    }
    const row = rows[0];
    if (row === undefined) return undefined;
    return yield* decodePersisted(operationName, () => {
      const markerTaskId = storedPublicTaskId(
        decodeStoredString(row.markerTaskId, "Active Task Review Task ID"),
      );
      const reviewTaskId = storedPublicTaskId(
        decodeStoredString(row.reviewTaskId, "Task Review Task ID"),
      );
      const reviewId = decodeStoredString(row.reviewId, "Active Task Review ID");
      if (reviewId.length === 0) throw new Error("Active Task Review ID must not be empty");
      if (
        markerTaskId !== taskId ||
        reviewTaskId !== taskId ||
        row.reviewState !== "running" ||
        row.reviewOutcome !== null
      ) {
        throw new Error("Active Task Review does not match its running Task Review");
      }
      return { reviewId, taskId } satisfies DecodedActiveTaskReview;
    });
  });
