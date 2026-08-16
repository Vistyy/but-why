import type { Effect } from "effect";
import { Effect as EffectRuntime } from "effect";

import type {
  ChangeReconciliationPort,
  ChangeSubmissionPort,
} from "../../../change/changePorts.js";
import type { CompleteMergedChangeInput } from "../../../change/changeStore.js";
import { RepositorySql } from "../../../sqlite/repositorySql.js";
import { requireTerminalChange } from "../../../sqlite/sqliteTerminalChangeStorage.js";
import { completeLinkedChange } from "./sqliteTaskChangePersistence.js";

export const openSqliteTaskChangeSubmissionPort = (
  owner: Effect.Effect<ChangeSubmissionPort, never, RepositorySql>,
): Effect.Effect<ChangeSubmissionPort, never, RepositorySql> =>
  owner.pipe(
    EffectRuntime.flatMap((ownerPort) =>
      EffectRuntime.map(RepositorySql, (repository) => ({
        ...ownerPort,
        completeMergedChange: (input: CompleteMergedChangeInput) =>
          repository.transactionImmediate("complete linked Change", (sql) =>
            EffectRuntime.gen(function* () {
              const result = yield* completeLinkedChange(sql, input);
              if (!result.ok) return result;
              return { ...result, changeId: input.changeId };
            }),
          ),
      })),
    ),
  );

export const openSqliteTaskChangeReconciliationPort = (
  owner: Effect.Effect<ChangeReconciliationPort, never, RepositorySql>,
): Effect.Effect<ChangeReconciliationPort, never, RepositorySql> =>
  owner.pipe(
    EffectRuntime.flatMap((ownerPort) =>
      EffectRuntime.map(RepositorySql, (repository) => ({
        ...ownerPort,
        completeMergedChange: (input: CompleteMergedChangeInput) =>
          repository.transactionImmediate("complete linked Change", (sql) =>
            EffectRuntime.gen(function* () {
              const result = yield* completeLinkedChange(sql, input);
              if (!result.ok) return result;
              const change = yield* requireTerminalChange(
                sql,
                input.changeId,
                "complete linked Change",
              );
              return { ...result, change };
            }),
          ),
      })),
    ),
  );
