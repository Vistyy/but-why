import { Effect } from "effect";

import type {
  ChangeReconciliationPort,
  ChangeSubmissionPort,
} from "../../../change/changePorts.js";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import { RepositorySql } from "../../../repositoryRuntime/adapters/sqlite/repositorySql.js";
import { requireTerminalChange } from "../../../repositoryRuntime/adapters/sqlite/sqliteTerminalChangeStorage.js";
import { completeLinkedChange } from "./sqliteTaskChangePersistence.js";

type SubmissionCompletion = ChangeSubmissionPort["completeMergedChange"];
type ReconciliationCompletion = ChangeReconciliationPort["completeMergedChange"];

export const openSqliteTaskChangeSubmissionCompletion = (): Effect.Effect<
  SubmissionCompletion,
  never,
  RepositorySql
> =>
  Effect.map(
    RepositorySql,
    (repository) => (input: CompleteMergedChangeInput) =>
      repository.transactionImmediate("complete linked Change", (sql) =>
        Effect.gen(function* () {
          const result = yield* completeLinkedChange(sql, input, repository.idPrefix);
          if (!result.ok) return result;
          return { ...result, changeId: input.changeId };
        }),
      ),
  );

export const openSqliteTaskChangeReconciliationCompletion = (): Effect.Effect<
  ReconciliationCompletion,
  never,
  RepositorySql
> =>
  Effect.map(
    RepositorySql,
    (repository) => (input: CompleteMergedChangeInput) =>
      repository.transactionImmediate("complete linked Change", (sql) =>
        Effect.gen(function* () {
          const result = yield* completeLinkedChange(sql, input, repository.idPrefix);
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
