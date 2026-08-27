import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  type RepositoryOperationRuntime,
  runRepositoryOperation,
} from "../../repositoryRuntime/repositoryOperation.js";
import type {
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
} from "../../task/taskStore.js";
import { editTaskDependenciesWithChangePrecondition } from "./taskChangeMutations.js";

export const editTaskDependencies = (
  runtime: RepositoryOperationRuntime,
  input: EditTaskDependenciesInput,
): Effect.Effect<EditTaskDependenciesResult, RepositoryOperationError> =>
  runRepositoryOperation(runtime, (_context, repository) =>
    repository.transactionImmediate("edit Task dependencies", (sql) =>
      editTaskDependenciesWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
