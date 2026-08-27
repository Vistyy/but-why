import type { Effect } from "effect";
import {
  type RepositoryOperationError,
  runRepositoryOperationAt,
} from "../../repositoryRuntime/repositoryOperation.js";
import type { ReviseTaskInput, ReviseTaskResult } from "../../task/taskStore.js";
import { reviseTaskWithChangePrecondition } from "./taskChangeMutations.js";

export const reviseTask = (
  cwd: string,
  input: ReviseTaskInput,
): Effect.Effect<ReviseTaskResult, RepositoryOperationError> =>
  runRepositoryOperationAt(cwd, (_context, repository) =>
    repository.transactionImmediate("revise Task", (sql) =>
      reviseTaskWithChangePrecondition(sql, input, repository.idPrefix),
    ),
  );
