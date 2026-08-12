import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

export const requirePassingReviewForUnlinkedTodoTasksMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE tasks
    SET state = 'new'
    WHERE state = 'todo'
      AND NOT EXISTS (
        SELECT 1 FROM changes
        WHERE changes.task_id = tasks.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM task_reviews
        WHERE task_reviews.task_id = tasks.id
          AND task_reviews.state = 'complete'
          AND task_reviews.outcome = 'passed'
      )
  `;
});
