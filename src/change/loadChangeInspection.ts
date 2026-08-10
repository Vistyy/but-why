import { existsSync } from "node:fs";

import { Effect } from "effect";
import { type LoadRepoLocalContextError, loadRepoLocalContext } from "../init/repoContext.js";
import { repositorySqlLayer } from "../sqlite/repositorySql.js";
import {
  openSqliteChangeAuthorityPort,
  openSqliteChangeQueryStore,
} from "../sqlite/sqliteChangePersistence.js";
import { openSqliteChangeQueryValidationStore } from "../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import type {
  ChangeAuthorityPort,
  ImplementationBlockerMutationResult,
  RecordImplementationDecisionResult,
} from "./changePorts.js";
import {
  type ChangeQueryPort,
  queryChangeDetail,
  queryChangeFindings,
  queryChangeTaskProjection,
  queryChangeValidationRuns,
} from "./inspectChange.js";

export type ChangeAuthorityCommands = {
  readonly raiseBlocker: ChangeAuthorityPort["raiseImplementationBlocker"];
  readonly resolveBlocker: ChangeAuthorityPort["resolveImplementationBlocker"];
  readonly addDecision: ChangeAuthorityPort["recordImplementationDecision"];
};

export type LoadChangeInspectionResult =
  | {
      readonly ok: true;
      readonly commonDirectory: string;
      readonly queries: ChangeQueryPort;
      readonly authority: ChangeAuthorityCommands;
    }
  | { readonly ok: false; readonly error: LoadRepoLocalContextError };

export const loadChangeInspection = (input: {
  readonly cwd: string;
}): LoadChangeInspectionResult => {
  const repoContext = loadRepoLocalContext(input.cwd);
  if (!repoContext.ok) return repoContext;
  if (!existsSync(repoContext.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        taskPrefix: repoContext.context.taskPrefix,
      },
    };
  }

  const context = repoContext.context;
  const repositoryLayer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
  });
  const queryPorts = Effect.all({
    changes: openSqliteChangeQueryStore(),
    validation: openSqliteChangeQueryValidationStore(),
  });
  const runQuery = <A, E>(
    use: (ports: Effect.Effect.Success<typeof queryPorts>) => Effect.Effect<A, E>,
  ) => Effect.flatMap(queryPorts, use).pipe(Effect.provide(repositoryLayer));

  const executionLock = openSqliteExecutionLock({ commonDirectory: context.commonDirectory });
  const runMutation = <
    A extends ImplementationBlockerMutationResult | RecordImplementationDecisionResult,
  >(
    changeId: string,
    use: (
      authority: Effect.Effect.Success<ReturnType<typeof openSqliteChangeAuthorityPort>>,
    ) => Effect.Effect<A, import("../contracts/repositoryStorageError.js").RepositoryStorageError>,
  ) =>
    executionLock
      .withLock({
        owner: "change_submission",
        key: changeId,
        effect: Effect.flatMap(openSqliteChangeAuthorityPort(), use).pipe(
          Effect.provide(repositoryLayer),
        ),
      })
      .pipe(
        Effect.catchTag("ExecutionLockUnavailable", () =>
          Effect.succeed({ ok: false as const, code: "submission_in_progress" as const }),
        ),
      );

  const dependencies = (ports: Effect.Effect.Success<typeof queryPorts>) => ports;

  return {
    ok: true,
    commonDirectory: context.commonDirectory,
    queries: {
      list: (listInput) => runQuery(({ changes }) => changes.listChanges(listInput)),
      taskProjection: (taskId) =>
        runQuery((ports) => queryChangeTaskProjection(dependencies(ports), taskId)),
      detail: (changeId) => runQuery((ports) => queryChangeDetail(dependencies(ports), changeId)),
      findings: (changeId) =>
        runQuery((ports) => queryChangeFindings(dependencies(ports), changeId)),
      validationRuns: (changeId) =>
        runQuery((ports) => queryChangeValidationRuns(dependencies(ports), changeId)),
      decisions: (changeId) =>
        runQuery(({ changes }) =>
          changes
            .getChangeById(changeId)
            .pipe(
              Effect.flatMap((change) =>
                change === undefined
                  ? Effect.succeed(undefined)
                  : changes.listImplementationDecisions(changeId),
              ),
            ),
        ),
      blockers: (changeId) =>
        runQuery(({ changes }) => changes.listImplementationBlockers(changeId)),
    },
    authority: {
      raiseBlocker: (command) =>
        runMutation(command.changeId, (authority) => authority.raiseImplementationBlocker(command)),
      resolveBlocker: (command) =>
        runMutation(command.changeId, (authority) =>
          authority.resolveImplementationBlocker(command),
        ),
      addDecision: (command) =>
        runMutation(command.changeId, (authority) =>
          authority.recordImplementationDecision(command),
        ),
    },
  };
};
