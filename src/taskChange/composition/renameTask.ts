import { Effect } from "effect";
import { getTaskById, renameTaskSqlite } from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import type { RenameTaskInput, RenameTaskResult } from "../../task/taskStore.js";
import { normalizeTaskTitle } from "../../task/taskTitle.js";
import { readTaskChangeLinkByTaskId } from "../adapters/sqlite/sqliteTaskChangePersistence.js";
import { runTaskChangeOperation, type TaskChangeOperationError } from "./taskChangeOperation.js";

export const renameTask = (
  cwd: string,
  input: RenameTaskInput,
): Effect.Effect<RenameTaskResult, TaskChangeOperationError> =>
  runTaskChangeOperation(cwd, (_context, repository) =>
    repository.transactionImmediate("rename Task", (sql) =>
      Effect.gen(function* () {
        const title = normalizeTaskTitle(input.title);
        if (!title.ok) return title;
        const current = yield* getTaskById(sql, input.taskId, repository.idPrefix);
        if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
        if (current.title === title.title) {
          return { ok: true as const, noOp: true, task: current };
        }
        const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, repository.idPrefix);
        if (link !== undefined) {
          return {
            ok: false as const,
            code: "task_change_linked" as const,
            changeId: link.changeId,
          };
        }
        return yield* renameTaskSqlite(sql, { ...input, title: title.title }, repository.idPrefix);
      }),
    ),
  );
