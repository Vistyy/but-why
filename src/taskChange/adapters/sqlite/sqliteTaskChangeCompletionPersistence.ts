import { Effect } from "effect";

import type {
  ChangeReconciliationPort,
  ChangeSubmissionPort,
} from "../../../change/changePorts.js";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { requireTerminalChange } from "../../../sqlite/sqliteTerminalChangeStorage.js";
import {
  completeLinkedChange,
  type TaskChangeCompletionOperations,
} from "./sqliteTaskChangePersistence.js";

type SubmissionCompletion = ChangeSubmissionPort["completeMergedChange"];
type ReconciliationCompletion = ChangeReconciliationPort["completeMergedChange"];

export const openSqliteTaskChangeSubmissionCompletion = (
  taskOperations: TaskChangeCompletionOperations,
): Effect.Effect<SubmissionCompletion, never, RepositorySql> =>
  Effect.map(
    RepositorySql,
    (repository) => (input: CompleteMergedChangeInput) =>
      repository.transactionImmediate("complete linked Change", (sql) =>
        Effect.gen(function* () {
          const result = yield* completeLinkedChange(
            sql,
            input,
            repository.idPrefix,
            taskOperations,
          );
          if (!result.ok) return result;
          return { ...result, changeId: input.changeId };
        }),
      ),
  );

export const openSqliteTaskChangeReconciliationCompletion = (
  taskOperations: TaskChangeCompletionOperations,
): Effect.Effect<ReconciliationCompletion, never, RepositorySql> =>
  Effect.map(
    RepositorySql,
    (repository) => (input: CompleteMergedChangeInput) =>
      repository.transactionImmediate("complete linked Change", (sql) =>
        Effect.gen(function* () {
          const result = yield* completeLinkedChange(
            sql,
            input,
            repository.idPrefix,
            taskOperations,
          );
          if (!result.ok) return result;
          const change = yield* requireTerminalChange(
            sql,
            input.changeId,
            "complete linked Change",
            repository.idPrefix,
          );
          return { ...result, change };
        }),
      ),
  );
