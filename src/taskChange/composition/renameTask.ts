import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import type { RenameTaskInput, RenameTaskResult } from "../../task/taskStore.js";
import { renameTaskWithChangePrecondition } from "./taskChangeMutations.js";

export const renameTask = (
  cwd: string,
  input: RenameTaskInput,
): Effect.Effect<RenameTaskResult, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transactionImmediate("rename Task", (sql) =>
      renameTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
