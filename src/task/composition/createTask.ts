import { Effect } from "effect";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import { createTaskSqlite } from "../adapters/sqlite/sqliteTaskPersistence.js";
import { resolveRepoTaskId, type RepoTaskIdResolution } from "../repoTaskIds.js";
import type { DependencyValidationCode, TaskContext, TaskRecord } from "../task.js";
import type { PublicTaskId } from "../taskId.js";
import type { CreateTaskInput } from "../taskStore.js";

export type CreateTaskResult =
  | { readonly ok: true; readonly task: TaskRecord; readonly context: TaskContext }
  | { readonly ok: false; readonly code: DependencyValidationCode; readonly taskId?: PublicTaskId }
  | {
      readonly ok: false;
      readonly error: Exclude<RepoTaskIdResolution, { readonly ok: true }>;
    };

export const createTask = (
  cwd: string,
  input: CreateTaskInput,
): Effect.Effect<CreateTaskResult, RepositoryOperationError> =>
  runRepositoryOperationAt<CreateTaskResult, RepositoryStorageError, never>(
    cwd,
    (context, repository) => {
      const dependsOn = (input.dependsOn ?? []).map((taskId) => resolveRepoTaskId(context, taskId));
      const unresolved = dependsOn.find((taskId) => !taskId.ok);
      if (unresolved !== undefined && !unresolved.ok) {
        return Effect.succeed({ ok: false as const, error: unresolved });
      }
      return repository.transactionImmediate("create Task", (sql) =>
        createTaskSqlite(sql, repository.idPrefix, {
          ...input,
          dependsOn: dependsOn.map((taskId) => {
            if (!taskId.ok) throw new Error("Task ID was not resolved");
            return taskId.taskId;
          }),
        }),
      );
    },
  );
