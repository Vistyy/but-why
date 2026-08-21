import { describe, expect, it } from "vitest";

import { assertValidationToolingFailureEvidence } from "../../src/change/candidateValidation/candidateValidationEvidence.js";
import { decodeTaskReviewToolingFailure } from "../../src/task/review/taskReview.js";

const dispatchFailure = {
  operation: "dispatch_agent_invocation",
  message: "Invocation dispatch is blocked.",
};

const validationDispatchFailure = {
  errorKind: "infrastructure_tooling_failed",
  operationName: "dispatch_agent_invocation",
  errorMessage: "Invocation dispatch is blocked.",
};

describe("dispatch Tooling Failure evidence", () => {
  it("requires the blocking Invocation ID only for dispatch failures", () => {
    const missingIdCases = [
      () => decodeTaskReviewToolingFailure(dispatchFailure),
      () => assertValidationToolingFailureEvidence(validationDispatchFailure),
    ];
    for (const check of missingIdCases) {
      expect(check).toThrow("requires a blocking Invocation ID");
    }

    const invalidIdCases = [
      () =>
        decodeTaskReviewToolingFailure({
          operation: "cleanup_task_review_workspace",
          message: "Cleanup failed.",
          blockingInvocationId: 1,
        }),
      () =>
        assertValidationToolingFailureEvidence({
          errorKind: "infrastructure_tooling_failed",
          operationName: "cleanup_snapshot_workspace",
          errorMessage: "Cleanup failed.",
          blockingInvocationId: 1,
        }),
    ];
    for (const check of invalidIdCases) {
      expect(check).toThrow("no other operation may provide");
    }
  });
});
