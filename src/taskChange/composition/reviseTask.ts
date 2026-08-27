import { Effect } from "effect";
import {
  reviseTaskSqlite,
  validateTaskRevisionTarget,
} from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import type { ReviseTaskInput, ReviseTaskResult } from "../../task/taskStore.js";
import { readTaskChangeLinkByTaskId } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import { runTaskChangeOperation, type TaskChangeOperationError } from "./taskChangeOperation.js";

export const reviseTask = (
  cwd: string,
  input: ReviseTaskInput,
): Effect.Effect<ReviseTaskResult, TaskChangeOperationError> =>
  runTaskChangeOperation(cwd, (_context, repository) =>
    repository.transactionImmediate("revise Task", (sql) =>
      Effect.gen(function* () {
        const current = yield* validateTaskRevisionTarget(sql, input.taskId, repository.idPrefix);
        if (!current.ok) return current;
        const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
        if (link !== undefined) {
          return {
            ok: false as const,
            code: "task_change_linked" as const,
            changeId: link.changeId,
          };
        }
        return yield* reviseTaskSqlite(sql, input, repository.idPrefix);
      }),
    ),
  );
