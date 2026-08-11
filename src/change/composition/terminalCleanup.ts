import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";

import type { LocalRepositoryContext } from "../../repositoryRuntime/repositoryContext.js";
import { openSqliteChangeReviewerTranscriptPort } from "../../sqlite/sqliteChangeReviewerTranscriptPersistence.js";
import { openSqliteTerminalChangeCleanupPort } from "../../sqlite/sqliteTerminalChangeCleanupPersistence.js";
import { openSqliteValidationArtifactLifecyclePort } from "../../sqlite/sqliteValidationArtifactLifecyclePersistence.js";
import { localGitHubChangeCleanupRemote } from "../../submissionEnvironment/localGitHubPullRequestGateway.js";
import { openTerminalCleanup } from "../cleanupTerminalChange.js";
import { cleanupChangeResourcesWithRemote } from "../localChangeCleanupGit.js";
import { reviewerSessionsChangeRoot } from "../reviewerSession/reviewerSession.js";
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
          reviewerSessionsChangeRoot(context.paths.operationalDir, changeId),
        artifactLifecycle: openArtifactLifecycle({
          persistence: artifactLifecyclePersistence,
          artifactsRoot: context.paths.artifactsPath,
        }),
      });
      return (...args: Parameters<typeof cleanup>) =>
        cleanup(...args).pipe(Effect.provide(NodeFileSystem.layer));
    }),
  );
