import type * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";

import type {
  ChangeReconciliationPort,
  ChangeSubmissionPort,
  ReconciliationChange,
} from "../../../change/changePorts.js";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import type { RepositoryPersistedDataInvalid } from "../../../contracts/repositoryStorageError.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import {
  completeLinkedChange,
  type TaskChangeCompletionOperations,
} from "./sqliteTaskChangePersistence.js";

export type TaskChangeTerminalOperations = {
  readonly requireTerminalChange: (
    sql: SqlClient.SqlClient,
    changeId: string,
    operationName: string,
    idPrefix: string,
  ) => Effect.Effect<ReconciliationChange, SqlError | RepositoryPersistedDataInvalid>;
};

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
  terminalOperations: TaskChangeTerminalOperations,
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
          const change = yield* terminalOperations.requireTerminalChange(
            sql,
            input.changeId,
            "complete linked Change",
            repository.idPrefix,
          );
          return { ...result, change };
        }),
      ),
  );
