import { Effect } from "effect";
import type {
  RepositoryPersistedDataInvalid,
  RepositorySqlOperationFailed,
} from "../../src/contracts/repositoryStorageError.js";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import type {
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
  RenameTaskInput,
  RenameTaskResult,
  ReviseTaskInput,
  ReviseTaskResult,
} from "../../src/task/taskStore.js";
import {
  editTaskDependenciesWithChangePrecondition,
  renameTaskWithChangePrecondition,
  reviseTaskWithChangePrecondition,
} from "../../src/taskChange/composition/taskChangeMutations.js";

export const editTaskDependenciesForTaskChange = (
  input: EditTaskDependenciesInput,
): Effect.Effect<
  EditTaskDependenciesResult,
  RepositoryPersistedDataInvalid | RepositorySqlOperationFailed,
  RepositorySql
> =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("edit Task dependencies", (sql) =>
      editTaskDependenciesWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );

export const renameTaskForTaskChange = (
  input: RenameTaskInput,
): Effect.Effect<
  RenameTaskResult,
  RepositoryPersistedDataInvalid | RepositorySqlOperationFailed,
  RepositorySql
> =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("rename Task", (sql) =>
      renameTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );

export const reviseTaskForTaskChange = (
  input: ReviseTaskInput,
): Effect.Effect<
  ReviseTaskResult,
  RepositoryPersistedDataInvalid | RepositorySqlOperationFailed,
  RepositorySql
> =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("revise Task", (sql) =>
      reviseTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
