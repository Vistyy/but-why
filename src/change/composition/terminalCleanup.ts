import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { reviewerSessionsOwnerRoot } from "../../agent/reviewerSession/reviewerSession.js";
import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { openSqliteChangeReviewerTranscriptPort } from "../../sqlite/sqliteChangeReviewerTranscriptPersistence.js";
import { openSqliteTerminalChangeCleanupPort } from "../../sqlite/sqliteTerminalChangeCleanupPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../../sqlite/sqliteValidationArtifactLifecyclePersistence.js";
import { localGitHubChangeCleanupRemote } from "../../submissionEnvironment/adapters/localGitHubPullRequestGateway.js";
import { cleanupChangeResourcesWithRemote } from "../adapters/localChangeCleanupGit.js";
import { openTerminalCleanup } from "../cleanupTerminalChange.js";
import { openReviewerTranscriptIndex } from "../reviewerSession/reviewerTranscript.js";
import { openArtifactLifecycle } from "../validationRun/artifactLifecycle.js";

export const composeTerminalCleanup = (context: LocalRepositoryContext) =>
  Effect.all({
    persistence: openSqliteTerminalChangeCleanupPort(),
    reviewerTranscripts: openSqliteChangeReviewerTranscriptPort(),
    artifactLifecyclePersistence: openSqliteValidationArtifactLifecyclePort(),
  }).pipe(
    Effect.map(({ persistence, reviewerTranscripts, artifactLifecyclePersistence }) => {
      const cleanup = openTerminalCleanup({
        persistence,
        cleanup: cleanupChangeResourcesWithRemote(
          localGitHubChangeCleanupRemote({ cwd: context.root }),
        ),
        indexTranscripts: openReviewerTranscriptIndex({ persistence: reviewerTranscripts }),
        reviewerSessionPathFor: (changeId) =>
          reviewerSessionsOwnerRoot(context.paths.operationalDir, changeId),
        artifactLifecycle: openArtifactLifecycle({
          persistence: artifactLifecyclePersistence,
          artifactsRoot: context.paths.artifactsPath,
        }),
      });
      return (...args: Parameters<typeof cleanup>) =>
        cleanup(...args).pipe(Effect.provide(NodeFileSystem.layer));
    }),
  );
