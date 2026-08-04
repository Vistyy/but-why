// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";

import type { CliEnvironment } from "../cli.js";
import { repoStateLoadError, runtimeError, success, type CliResult } from "../cliResults.js";
import { loadSnapshotUseCases } from "../repositorySnapshot/loadSnapshotUseCases.js";

export const runSnapshotCommand = (environment: CliEnvironment): Effect.Effect<CliResult> =>
  loadSnapshotUseCases(environment.cwd).pipe(
    Effect.flatMap((loaded) => {
      if (!loaded.ok) return Effect.succeed(repoStateLoadError(loaded.error));

      return loaded.useCases.create().pipe(
        Effect.map((snapshot) => success({ snapshotPath: snapshot.snapshotPath })),
        Effect.catchTag("SnapshotCreationFailed", () =>
          Effect.succeed(
            runtimeError({
              code: "snapshot_creation_failed",
              message: "Shared Repository State Snapshot creation failed.",
              help: ["Check that Shared Repository State is readable, then retry `by snapshot`."],
            }),
          ),
        ),
      );
    }),
  );
