import { Effect } from "effect";
import {
  RepositoryPersistedDataInvalid,
  type RepositoryStorageError,
} from "../../contracts/repositoryStorageError.js";
import type { ResolveLocalRepositoryError } from "../../repositoryRuntime/repositoryContext.js";
import { openRepositoryRuntime } from "../../repositoryRuntime/repositoryRuntime.js";
import { openSqliteActiveValidationRunPort } from "../../sqlite/sqliteActiveValidationRunPersistence.js";
import { openSqliteChangeAuthorityPort } from "../../sqlite/sqliteChangeAuthorityPersistence.js";
import { openSqliteChangeReadPort } from "../../sqlite/sqliteChangeInspectionPersistence.js";
import { openSqliteChangeValidationReadPort } from "../../sqlite/sqliteChangeValidationReadPersistence.js";
import { openSqliteExecutionLock } from "../../sqlite/sqliteExecutionLock.js";
import type {
  ChangeAuthorityPort,
  ChangeReadPort,
  ImplementationBlockerMutationResult,
  RaiseImplementationBlockerInput,
  RecordImplementationDecisionInput,
  RecordImplementationDecisionResult,
  ResolveImplementationBlockerInput,
} from "../changePorts.js";
import type { ListChangesInput } from "../changeStore.js";
import {
  queryChangeDetail,
  queryChangeFindings,
  queryChangeTaskProjection,
  queryChangeValidationRuns,
} from "../inspectChange.js";

type LoadChangeInspectionError =
  | ResolveLocalRepositoryError
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

const loadContext = (input: LoadInput) => openRepositoryRuntime(input.cwd);

const loadOperation = <A>(
  input: LoadInput,
  makeOperation: (runtime: LoadedContext["runtime"]) => A,
): LoadedChangeInspectionOperation<A> => {
  const loaded = loadContext(input);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    commonDirectory: loaded.runtime.context.commonDirectory,
    operation: makeOperation(loaded.runtime),
  };
};

export const loadChangeList = (input: LoadInput) =>
  loadOperation(
    input,
    (context) => (listInput: ListChangesInput) =>
      context.provide(
        Effect.flatMap(openSqliteChangeReadPort(), (changes) => changes.listChanges(listInput)),
      ),
  );

export const loadChangeTaskProjection = (input: LoadInput) =>
  loadOperation(
    input,
    (context) => (taskId: string) =>
      context.provide(
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
      context.provide(
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
      context.provide(
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
      context.provide(
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
      context.provide(
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
    changes: ChangeReadPort,
  ) => Effect.Effect<Result, RepositoryStorageError>,
) =>
  loadOperation(
    input,
    (context) => (command: Input) =>
      openSqliteExecutionLock({ commonDirectory: context.context.commonDirectory })
        .withLock({
          owner: "change_submission",
          key: command.changeId,
          effect: context.provide(
            Effect.all({
              authority: openSqliteChangeAuthorityPort(),
              changes: openSqliteChangeReadPort(),
            }).pipe(
              Effect.flatMap(({ authority, changes }) => mutate(authority, command, changes)),
            ),
          ),
        })
        .pipe(
          Effect.catchTag("ExecutionLockUnavailable", () =>
            Effect.succeed({ ok: false as const, code: "submission_in_progress" as const }),
          ),
        ),
  );

const loadBlockerMutation = <Input extends { readonly changeId: string }>(
  input: LoadInput,
  mutate: (
    authority: ChangeAuthorityPort,
    command: Input,
  ) => ReturnType<ChangeAuthorityPort["raiseImplementationBlocker"]>,
) =>
  loadAuthorityMutation<Input, ImplementationBlockerMutationResult>(
    input,
    (authority, command, changes) =>
      Effect.gen(function* () {
        const result = yield* mutate(authority, command);
        if (!result.ok) return result;
        const change = yield* changes.getChangeById(command.changeId);
        if (change === undefined) {
          return yield* Effect.fail(
            new RepositoryPersistedDataInvalid({
              operationName: "construct Implementation Blocker CLI output",
              cause: new Error("Change disappeared"),
            }),
          );
        }
        return { ...result, change };
      }),
  );

export const loadRaiseImplementationBlocker = (input: LoadInput) =>
  loadBlockerMutation(input, (authority, command: RaiseImplementationBlockerInput) =>
    authority.raiseImplementationBlocker(command),
  );

export const loadResolveImplementationBlocker = (input: LoadInput) =>
  loadBlockerMutation(input, (authority, command: ResolveImplementationBlockerInput) =>
    authority.resolveImplementationBlocker(command),
  );

export const loadRecordImplementationDecision = (input: LoadInput) =>
  loadAuthorityMutation<RecordImplementationDecisionInput, RecordImplementationDecisionResult>(
    input,
    (authority, command) => authority.recordImplementationDecision(command),
  );
