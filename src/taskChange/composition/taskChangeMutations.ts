import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import {
  editTaskDependenciesAfterValidationSqlite,
  getTaskById,
  renameTaskAfterValidationSqlite,
  reviseTaskAfterValidationSqlite,
  validateTaskDependencyEditTarget,
  validateTaskRevisionTarget,
} from "../../task/adapters/sqlite/sqliteTaskPersistence.js";
import type {
  EditTaskDependenciesInput,
  RenameTaskInput,
  ReviseTaskInput,
} from "../../task/taskStore.js";
import { normalizeTaskTitle } from "../../task/taskTitle.js";
import { readTaskChangeLinkByTaskId } from "../adapters/sqlite/sqliteTaskChangePersistence.js";

export const editTaskDependenciesWithChangePrecondition = (
  sql: SqlClient.SqlClient,
  input: EditTaskDependenciesInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const target = yield* validateTaskDependencyEditTarget(sql, input.taskId, idPrefix);
    if (!target.ok) return target;
    const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, idPrefix);
    if (link !== undefined) {
      return {
        ok: false as const,
        code: "dependencies_locked" as const,
        state: target.task.state,
      };
    }
    return yield* editTaskDependenciesAfterValidationSqlite(sql, input, target, idPrefix);
  });

export const renameTaskWithChangePrecondition = (
  sql: SqlClient.SqlClient,
  input: RenameTaskInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const title = normalizeTaskTitle(input.title);
    if (!title.ok) return title;
    const current = yield* getTaskById(sql, input.taskId, idPrefix);
    if (current === undefined) return { ok: false as const, code: "task_not_found" as const };
    if (current.title === title.title) {
      return { ok: true as const, noOp: true, task: current };
    }
    const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, idPrefix);
    if (link !== undefined) {
      return {
        ok: false as const,
        code: "task_change_linked" as const,
        changeId: link.changeId,
      };
    }
    return yield* renameTaskAfterValidationSqlite(sql, input, title.title, current, idPrefix);
  });

export const reviseTaskWithChangePrecondition = (
  sql: SqlClient.SqlClient,
  input: ReviseTaskInput,
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const current = yield* validateTaskRevisionTarget(sql, input.taskId, idPrefix);
    if (!current.ok) return current;
    const link = yield* readTaskChangeLinkByTaskId(sql, input.taskId, idPrefix);
    if (link !== undefined) {
      return {
        ok: false as const,
        code: "task_change_linked" as const,
        changeId: link.changeId,
      };
    }
    return yield* reviseTaskAfterValidationSqlite(sql, input, current, idPrefix);
  });
