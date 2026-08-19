import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { openSqliteTerminalChangeCleanupPort } from "../../repositoryRuntime/adapters/sqlite/sqliteTerminalChangeCleanupPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../../repositoryRuntime/adapters/sqlite/sqliteValidationArtifactLifecyclePersistence.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { localGitHubChangeCleanupRemote } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { cleanupChangeResourcesWithRemote } from "../adapters/localChangeCleanupGit.js";
import { openTerminalCleanup } from "../cleanupTerminalChange.js";
import { openArtifactLifecycle } from "../validationRun/artifactLifecycle.js";

export const composeTerminalCleanup = (context: LocalRepositoryContext) =>
  Effect.all({
    persistence: openSqliteTerminalChangeCleanupPort(),
    artifactLifecyclePersistence: openSqliteValidationArtifactLifecyclePort(),
  }).pipe(
    Effect.map(({ persistence, artifactLifecyclePersistence }) => {
      const cleanup = openTerminalCleanup({
        persistence,
        cleanup: cleanupChangeResourcesWithRemote(
          localGitHubChangeCleanupRemote({ cwd: context.root }),
        ),
        artifactLifecycle: openArtifactLifecycle({
          persistence: artifactLifecyclePersistence,
          artifactsRoot: context.paths.artifactsPath,
        }),
      });
      return (...args: Parameters<typeof cleanup>) =>
        cleanup(...args).pipe(Effect.provide(NodeFileSystem.layer));
    }),
  );
