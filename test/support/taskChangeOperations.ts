import { Effect } from "effect";
import { RepositorySql } from "../../src/repositoryRuntime/adapters/sqlite/repositorySql.js";
import type {
  EditTaskDependenciesInput,
  RenameTaskInput,
  ReviseTaskInput,
} from "../../src/task/taskStore.js";
import {
  editTaskDependenciesWithChangePrecondition,
  renameTaskWithChangePrecondition,
  reviseTaskWithChangePrecondition,
} from "../../src/taskChange/composition/taskChangeMutations.js";

export const editTaskDependenciesForTaskChange = (input: EditTaskDependenciesInput) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("edit Task dependencies", (sql) =>
      editTaskDependenciesWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );

export const renameTaskForTaskChange = (input: RenameTaskInput) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("rename Task", (sql) =>
      renameTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );

export const reviseTaskForTaskChange = (input: ReviseTaskInput) =>
  Effect.flatMap(RepositorySql, (repository) =>
    repository.transactionImmediate("revise Task", (sql) =>
      reviseTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
