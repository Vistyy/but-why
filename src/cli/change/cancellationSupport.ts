import { Effect } from "effect";

import type { CancellationUseCases } from "../../change/cancelChange.js";
import { withCancellationUseCases } from "../../taskChange/composition/loadCancellation.js";
import {
  type CliResult,
  repoStateLoadError,
  repositoryStorageErrorResult,
} from "../../cliResults.js";
import type { RepositoryStorageError } from "../../contracts/repositoryStorageError.js";

export type CancellationCommandEnvironment = {
  readonly cwd: string;
  readonly cancellationUseCases?: CancellationUseCases;
};

export const withCancellation = <A, R>(
  environment: CancellationCommandEnvironment,
  use: (cancellation: CancellationUseCases) => Effect.Effect<A, RepositoryStorageError, R>,
): Effect.Effect<A | CliResult, never, R> => {
  const program =
    environment.cancellationUseCases === undefined
      ? withCancellationUseCases(environment.cwd, use).pipe(
          Effect.map((result) => (result.ok ? result.value : repoStateLoadError(result.error))),
        )
      : use(environment.cancellationUseCases);

  return program.pipe(
    Effect.catchAll((error) => Effect.succeed(repositoryStorageErrorResult(error))),
  );
};
