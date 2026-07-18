import { encodeReviewerWireValue } from "../agent/reviewerOutputWire.js";
import type { TaskContextSnapshotV1 } from "../validationRun/taskContextSnapshot.js";

export const acceptanceReviewPrompt = (input: {
  readonly instructions: string;
  readonly candidate: {
    readonly candidateId: string;
    readonly comparisonBaseSha: string;
    readonly headSha: string;
  };
  readonly acceptanceContext: TaskContextSnapshotV1;
}): string =>
  [
    input.instructions,
    "",
    "Candidate:",
    encodeReviewerWireValue(input.candidate),
    "",
    "Immutable Acceptance Context:",
    encodeReviewerWireValue(input.acceptanceContext),
  ].join("\n");
