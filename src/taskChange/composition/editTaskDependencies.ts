import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import type {
  EditTaskDependenciesInput,
  EditTaskDependenciesResult,
} from "../../task/taskStore.js";
import { editTaskDependenciesWithChangePrecondition } from "./taskChangeMutations.js";

export const editTaskDependencies = (
  cwd: string,
  input: EditTaskDependenciesInput,
): Effect.Effect<EditTaskDependenciesResult, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transactionImmediate("edit Task dependencies", (sql) =>
      editTaskDependenciesWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
