// fallow-ignore-file duplicate-export -- shared Change command support

import { Effect } from "effect";
import type { CandidateValidationRunRecord } from "../../change/candidateValidation/candidateValidationRunStore.js";
import type { ChangeRecord } from "../../change/change.js";
import type { LoadedChangeOperationResult } from "../../change/composition/loadChangeLifecycle.js";
import type { RepoStateLoadError } from "../../cliResults.js";
import {
  type CliResult,
  repoStateLoadError,
  repositoryStorageErrorResult,
  runtimeError,
  stateStoreUnavailable,
} from "../../cliResults.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";
import { rejectedExplicitChangeId, resolveChangeId } from "./changeTarget.js";

export { rejectedExplicitChangeId };

import { structuredValue } from "../../output/structuredValue.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import { prepareFailureView } from "./sharedResults.js";

export const withResolvedChangeId = <E, R>(
  changeId: string | undefined,
  environment: ChangeCommandEnvironment,
  commandName: string,
  use: (changeId: string) => Effect.Effect<CliResult, E, R>,
): Effect.Effect<CliResult, E, R> =>
  resolveChangeId(changeId, environment.cwd, commandName).pipe(
    Effect.flatMap((resolved) =>
      resolved.ok ? use(resolved.changeId) : Effect.succeed(resolved.result),
    ),
  );

export const changeInspectionView = (change: ChangeRecord) => ({
  id: change.id,
  state: change.state,
  closeReason: change.closeReason,
  ...(change.cancelReason === null ? {} : { cancelReason: change.cancelReason }),
  branchRef: change.branchRef,
  baseRef: change.baseRef,
  worktreePath: change.worktreePath,
  acceptanceContext: change.acceptanceContext,
  policy: structuredValue({
    ...change.policy,
    ...(change.policy.stallDetection?.enabled === true
      ? { stallDetection: change.policy.stallDetection }
      : { stallDetection: undefined }),
  }),
  ...(change.prepareFailure === null
    ? {}
    : { prepareFailure: prepareFailureView(change.prepareFailure) }),
});

export const compactValidationRunView = (run: CandidateValidationRunRecord | null) =>
  run === null
    ? null
    : {
        id: run.id,
        candidateId: run.candidateId,
        state: run.state,
        outcome: run.outcome,
      };

export const validationRunHistoryView = (runs: readonly CandidateValidationRunRecord[]) => {
  const outcomeCounts: Record<string, number> = {};
  let runningCount = 0;
  for (const run of runs) {
    if (run.state === "running") runningCount += 1;
    if (run.outcome !== null) outcomeCounts[run.outcome] = (outcomeCounts[run.outcome] ?? 0) + 1;
  }
  return {
    count: runs.length,
    outcomeCounts,
    runningCount,
    validationRuns: runs.map(compactValidationRunView),
    ...(runs.length === 0 ? {} : { detailCommand: "by validation-run show <validation-run-id>" }),
  };
};

export const changeNotFound = (): CliResult =>
  runtimeError({
    code: "change_not_found",
    message: "Change was not found.",
    help: ["Use a Change ID returned by `by change list --all`."],
  });

export const inspectionFailure = <A>(
  effect: Effect.Effect<A, RepositoryStorageError>,
): Effect.Effect<A | CliResult> =>
  effect.pipe(
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(stateStoreUnavailable("repository"))),
  );

export const changeOperationInput = (environment: ChangeCommandEnvironment) => ({
  cwd: environment.cwd,
  globalConfigPath: environment.globalConfigPath,
  ...(environment.herdrSocketPath === undefined
    ? {}
    : { herdrSocketPath: environment.herdrSocketPath }),
  ...(environment.interactiveSessionHost === undefined
    ? {}
    : { interactiveSessionHost: environment.interactiveSessionHost }),
  platform: environment.platform,
});

export const loadedChangeOperation = (
  operation: Effect.Effect<LoadedChangeOperationResult<CliResult>, RepositoryStorageError>,
  unexpectedFailure: () => CliResult = () => stateStoreUnavailable("repository"),
): Effect.Effect<CliResult> =>
  operation.pipe(
    Effect.map((result) => (result.ok ? result.value : loadError(result.error))),
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
    Effect.catchAllCause(() => Effect.succeed(unexpectedFailure())),
  );

export const loadError = (error: RepoStateLoadError): CliResult => repoStateLoadError(error);
