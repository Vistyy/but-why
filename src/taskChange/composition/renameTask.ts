import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  type RepositoryOperationRuntime,
  runRepositoryOperation,
} from "../../repositoryRuntime/repositoryOperation.js";
import type { RenameTaskInput, RenameTaskResult } from "../../task/taskStore.js";
import { renameTaskWithChangePrecondition } from "./taskChangeMutations.js";

export const renameTask = (
  runtime: RepositoryOperationRuntime,
  input: RenameTaskInput,
): Effect.Effect<RenameTaskResult, RepositoryOperationError> =>
  runRepositoryOperation(runtime, (_context, repository) =>
    repository.transactionImmediate("rename Task", (sql) =>
      renameTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
