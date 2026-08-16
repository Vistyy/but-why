// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import { loadChangeDetail } from "../../change/composition/loadChangeInspection.js";
import type { CliResult } from "../../cliResults.js";
import { success } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";

export const runShow = (
  command: { readonly changeId: string | undefined },
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> =>
  support.withResolvedChangeId(command.changeId, environment, "show", (changeId) => {
    const loaded = loadChangeDetail({
      cwd: environment.cwd,
    });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.operation(changeId).pipe(
      Effect.map((detail) =>
        detail === undefined
          ? support.changeNotFound()
          : success({
              change: support.changeInspectionView(detail.change),
              ...(detail.change.implementationDecisions.length === 0
                ? {}
                : { implementationDecisions: detail.change.implementationDecisions }),
              currentCandidate: detail.currentCandidate,
              currentValidationRun: support.compactValidationRunView(detail.currentValidationRun),
              findingCount: detail.findings.length,
              toolingFailureCount: detail.toolingFailures.length,
              legacyReviewerEvidence: detail.legacyReviewerEvidence,
              ...(detail.findings.length === 0
                ? {}
                : { findingsCommand: `by change findings ${detail.change.id}` }),
              ...(detail.toolingFailures.length === 0
                ? {}
                : {
                    validationRunCommand: `by validation-run show ${detail.currentValidationRun?.id}`,
                  }),
              ...(detail.change.publication === null
                ? {}
                : {
                    publication: {
                      candidateId: detail.change.publication.candidateId,
                      validationRunId: detail.change.publication.validationRunId,
                      expectedHeadSha: detail.change.publication.expectedHeadSha,
                      pullRequest: detail.change.publication.pullRequest,
                    },
                  }),
              pullRequest: detail.change.publication?.pullRequest ?? null,
              cleanup: detail.change.cleanup,
            }),
      ),
      support.inspectionFailure,
    );
  });
