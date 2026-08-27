import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  type RepositoryOperationRuntime,
  runRepositoryOperation,
} from "../../repositoryRuntime/repositoryOperation.js";
import type { ReviseTaskInput, ReviseTaskResult } from "../../task/taskStore.js";
import { reviseTaskWithChangePrecondition } from "./taskChangeMutations.js";

export const reviseTask = (
  runtime: RepositoryOperationRuntime,
  input: ReviseTaskInput,
): Effect.Effect<ReviseTaskResult, RepositoryOperationError> =>
  runRepositoryOperation(runtime, (_context, repository) =>
    repository.transactionImmediate("revise Task", (sql) =>
      reviseTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
