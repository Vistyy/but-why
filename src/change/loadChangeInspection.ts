import { existsSync } from "node:fs";

import { Effect } from "effect";
import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { type LoadRepoLocalContextError, loadRepoLocalContext } from "../init/repoContext.js";
import { type RepositorySql, repositorySqlLayer } from "../sqlite/repositorySql.js";
import {
  openSqliteChangeAuthorityPort,
  openSqliteChangeReadPort,
} from "../sqlite/sqliteChangePersistence.js";
import {
  openSqliteActiveValidationRunPort,
  openSqliteChangeValidationReadPort,
} from "../sqlite/sqliteChangeValidationPersistence.js";
import { openSqliteExecutionLock } from "../sqlite/sqliteExecutionLock.js";
import type {
  ChangeAuthorityPort,
  ImplementationBlockerMutationResult,
  RaiseImplementationBlockerInput,
  RecordImplementationDecisionInput,
  RecordImplementationDecisionResult,
  ResolveImplementationBlockerInput,
} from "./changePorts.js";
import type { ListChangesInput } from "./changeStore.js";
import {
  queryChangeDetail,
  queryChangeFindings,
  queryChangeTaskProjection,
  queryChangeValidationRuns,
} from "./inspectChange.js";

type LoadChangeInspectionError =
  | LoadRepoLocalContextError
  | { readonly code: "state_store_unavailable"; readonly taskPrefix: string };

type LoadedChangeInspectionOperation<A> =
  | {
      readonly ok: true;
      readonly commonDirectory: string;
      readonly operation: A;
    }
  | { readonly ok: false; readonly error: LoadChangeInspectionError };

type LoadInput = { readonly cwd: string };

type LoadedContext = Exclude<ReturnType<typeof loadContext>, { readonly ok: false }>;

const loadContext = (input: LoadInput) => {
  const loaded = loadRepoLocalContext(input.cwd);
  if (!loaded.ok) return loaded;
  if (!existsSync(loaded.context.paths.statePath)) {
    return {
      ok: false as const,
      error: {
        code: "state_store_unavailable" as const,
        taskPrefix: loaded.context.taskPrefix,
      },
    };
  }
  return loaded;
};

const loadOperation = <A>(
  input: LoadInput,
  makeOperation: (context: LoadedContext["context"]) => A,
): LoadedChangeInspectionOperation<A> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    commonDirectory: loaded.context.commonDirectory,
    operation: makeOperation(loaded.context),
  };
};

const provideRepository = <A, E>(
  context: LoadedContext["context"],
  effect: Effect.Effect<A, E, RepositorySql>,
) =>
  effect.pipe(
    Effect.provide(
      repositorySqlLayer({
        statePath: context.paths.statePath,
        commonDirectory: context.commonDirectory,
      }),
    ),
  );

export const loadChangeList = (input: LoadInput) =>
  loadOperation(
    input,
    (context) => (listInput: ListChangesInput) =>
      provideRepository(
        context,
        Effect.flatMap(openSqliteChangeReadPort(), (changes) => changes.listChanges(listInput)),
      ),
  );

export const loadChangeTaskProjection = (input: LoadInput) =>
  loadOperation(
    input,
    (context) => (taskId: string) =>
      provideRepository(
        context,
        Effect.all({
          changes: openSqliteChangeReadPort(),
          authority: openSqliteChangeAuthorityPort(),
          activeValidation: openSqliteActiveValidationRunPort(),
        }).pipe(
          Effect.flatMap(({ changes, authority, activeValidation }) =>
            queryChangeTaskProjection(
              {
                getChangeByTaskId: changes.getChangeByTaskId,
                getCurrentPassingEvidence: authority.getCurrentPassingEvidence,
                getActiveForChange: activeValidation.getActiveForChange,
              },
              taskId,
            ),
          ),
        ),
      ),
  );

const loadChangeDetailOperation = <A>(
  input: LoadInput,
  query: (
    dependencies: Parameters<typeof queryChangeDetail>[0],
    changeId: string,
  ) => Effect.Effect<A, RepositoryStorageError>,
) =>
  loadOperation(
    input,
    (context) => (changeId: string) =>
      provideRepository(
        context,
        Effect.all({
          changes: openSqliteChangeReadPort(),
          validation: openSqliteChangeValidationReadPort(),
        }).pipe(
          Effect.flatMap(({ changes, validation }) =>
            query(
              {
                getChangeById: changes.getChangeById,
                getCurrentCandidateForChange: validation.getCurrentCandidateForChange,
                getLatestRunForCandidate: validation.getLatestRunForCandidate,
                listFindings: validation.listFindings,
                listToolingFailures: validation.listToolingFailures,
              },
              changeId,
            ),
          ),
        ),
      ),
  );

export const loadChangeDetail = (input: LoadInput) =>
  loadChangeDetailOperation(input, queryChangeDetail);

export const loadChangeFindings = (input: LoadInput) =>
  loadChangeDetailOperation(input, queryChangeFindings);

export const loadChangeValidationRuns = (input: LoadInput) =>
  loadOperation(
    input,
    (context) => (changeId: string) =>
      provideRepository(
        context,
        Effect.all({
          changes: openSqliteChangeReadPort(),
          validation: openSqliteChangeValidationReadPort(),
        }).pipe(
          Effect.flatMap(({ changes, validation }) =>
            queryChangeValidationRuns(
              {
                getChangeById: changes.getChangeById,
                listCandidatesForChange: validation.listCandidatesForChange,
                listRunsForCandidate: validation.listRunsForCandidate,
              },
              changeId,
            ),
          ),
        ),
      ),
  );

export const loadImplementationDecisions = (input: LoadInput) =>
  loadOperation(
    input,
    (context) => (changeId: string) =>
      provideRepository(
        context,
        Effect.all({
          changes: openSqliteChangeReadPort(),
          authority: openSqliteChangeAuthorityPort(),
        }).pipe(
          Effect.flatMap(({ changes, authority }) =>
            changes
              .getChangeById(changeId)
              .pipe(
                Effect.flatMap((change) =>
                  change === undefined
                    ? Effect.succeed(undefined)
                    : authority.listImplementationDecisions(changeId),
                ),
              ),
          ),
        ),
      ),
  );

export const loadImplementationBlockers = (input: LoadInput) =>
  loadOperation(
    input,
    (context) => (changeId: string) =>
      provideRepository(
        context,
        Effect.flatMap(openSqliteChangeAuthorityPort(), (authority) =>
          authority.listImplementationBlockers(changeId),
        ),
      ),
  );

const loadAuthorityMutation = <
  Input extends { readonly changeId: string },
  Result extends ImplementationBlockerMutationResult | RecordImplementationDecisionResult,
>(
  input: LoadInput,
  mutate: (
    authority: ChangeAuthorityPort,
    command: Input,
  ) => Effect.Effect<Result, RepositoryStorageError>,
) =>
  loadOperation(
    input,
    (context) => (command: Input) =>
      openSqliteExecutionLock({ commonDirectory: context.commonDirectory })
        .withLock({
          owner: "change_submission",
          key: command.changeId,
          effect: provideRepository(
            context,
            Effect.flatMap(openSqliteChangeAuthorityPort(), (authority) =>
              mutate(authority, command),
            ),
          ),
        })
        .pipe(
          Effect.catchTag("ExecutionLockUnavailable", () =>
            Effect.succeed({ ok: false as const, code: "submission_in_progress" as const }),
          ),
        ),
  );

export const loadRaiseImplementationBlocker = (input: LoadInput) =>
  loadAuthorityMutation<RaiseImplementationBlockerInput, ImplementationBlockerMutationResult>(
    input,
    (authority, command) => authority.raiseImplementationBlocker(command),
  );

export const loadResolveImplementationBlocker = (input: LoadInput) =>
  loadAuthorityMutation<ResolveImplementationBlockerInput, ImplementationBlockerMutationResult>(
    input,
    (authority, command) => authority.resolveImplementationBlocker(command),
  );

export const loadRecordImplementationDecision = (input: LoadInput) =>
  loadAuthorityMutation<RecordImplementationDecisionInput, RecordImplementationDecisionResult>(
    input,
    (authority, command) => authority.recordImplementationDecision(command),
  );
