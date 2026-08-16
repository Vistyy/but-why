import { Effect } from "effect";
import { RepositorySql } from "../../../sqlite/repositorySql.js";
import {
  admitTaskReview,
  taskReviewAdmissionRejection,
} from "../../../sqlite/sqliteTaskReviewPersistence.js";
import type {
  AdmitTaskReviewInput,
  TaskReviewAdmissionPersistence,
} from "../../../task/review/taskReviewPersistence.js";
import { readTaskChangeLinkByTaskId } from "./sqliteTaskChangePersistence.js";

export type TaskChangeReviewAdmissionPersistence = TaskReviewAdmissionPersistence;

export const openSqliteTaskChangeReviewAdmissionPersistence = (): Effect.Effect<
  TaskChangeReviewAdmissionPersistence,
  never,
  RepositorySql
> =>
  Effect.map(RepositorySql, (repository) => ({
    checkAdmission: (taskId) =>
      repository.transaction("check Task Review admission", (sql) =>
        Effect.flatMap(readTaskChangeLinkByTaskId(sql, taskId), (link) =>
          taskReviewAdmissionRejection(sql, taskId, link?.changeId),
        ),
      ),
    admit: (input: AdmitTaskReviewInput) =>
      repository.transactionImmediate("admit Task Review", (sql) =>
        Effect.flatMap(readTaskChangeLinkByTaskId(sql, input.taskId), (link) =>
          admitTaskReview(sql, input, link?.changeId),
        ),
      ),
  }));
