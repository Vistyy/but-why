import { describe, expect, it } from "vitest";

import { submitResult } from "../../src/cli/change/submitResult.js";

describe("Change Submit Change Policy errors", () => {
  it("serializes remote mismatch commits and normalized failure evidence", () => {
    const result = submitResult(
      {
        ok: false,
        code: "publication_remote_mismatch",
        evidence: {
          operation: "branch_push",
          classification: "rejected",
          exitStatus: 1,
        },
        expectedRemoteHeadSha: "expected-head",
        observedRemoteHeadSha: "observed-head",
      },
      "change-1",
    );

    expect(result).toMatchObject({
      exitCode: 1,
      stdout: {
        error: {
          code: "publication_remote_mismatch",
          expectedCommit: "expected-head",
          observedCommit: "observed-head",
          evidence: { operation: "branch_push", classification: "rejected" },
        },
      },
    });
  });

  it("serializes local head preflight evidence", () => {
    const result = submitResult(
      {
        ok: false,
        code: "current_head_mismatch",
        evidence: {
          operation: "branch_push",
          classification: "rejected",
          exitStatus: 128,
        },
      },
      "change-1",
    );
    expect(result).toMatchObject({
      exitCode: 1,
      stdout: {
        error: {
          code: "current_head_mismatch",
          evidence: { operation: "branch_push", exitStatus: 128 },
        },
      },
    });
  });

  it("serializes normalized recovery failures with retry guidance", () => {
    for (const code of [
      "publication_creation_unconfirmed",
      "publication_lookup_ambiguous",
      "publication_tooling_failed",
    ] as const) {
      const result = submitResult(
        {
          ok: false,
          code,
          evidence: {
            operation: "pull_request_creation",
            classification: "response_parse_failure",
          },
        },
        "change-1",
      );
      expect(result).toMatchObject({
        exitCode: 1,
        stdout: {
          error: {
            code,
            evidence: {
              operation: "pull_request_creation",
              classification: "response_parse_failure",
            },
          },
          help: ["Inspect the pending publication and retry Submit."],
        },
      });
    }
  });

  it("does not give pending-publication guidance after a safely retryable absent branch", () => {
    expect(
      submitResult(
        {
          ok: false,
          code: "publication_tooling_failed",
          evidence: {
            operation: "branch_push",
            classification: "rejected",
            exitStatus: 1,
          },
          recoveryEvidence: {
            operation: "remote_lookup",
            classification: "conflict",
            remoteBranchState: "retryable_absence",
          },
        },
        "change-1",
      ),
    ).toMatchObject({
      exitCode: 1,
      stdout: {
        error: {
          message: "The uncertain initial push was observed with an absent Remote Change Branch.",
          recoveryEvidence: { remoteBranchState: "retryable_absence" },
        },
        help: ["Retry Change Submit after confirming the publication remote is available."],
      },
    });
  });

  it("gives destination-specific recovery guidance", () => {
    expect(
      submitResult(
        {
          ok: false,
          code: "publication_tooling_failed",
          evidence: {
            operation: "push_destination",
            classification: "rejected",
            reason: "repository_mismatch",
            destinationOwner: "other",
            destinationRepo: "widgets",
          },
        },
        "change-1",
      ),
    ).toMatchObject({
      exitCode: 1,
      stdout: {
        error: {
          code: "publication_tooling_failed",
          message:
            "Exactly one safe push destination could not be validated for the selected publication remote.",
          evidence: {
            operation: "push_destination",
            reason: "repository_mismatch",
          },
        },
        help: [
          "Correct the selected publication remote's effective push destination, then retry Submit.",
        ],
      },
    });

    expect(
      submitResult(
        {
          ok: false,
          code: "publication_tooling_failed",
          evidence: {
            operation: "push_destination",
            classification: "unavailable",
            reason: "unavailable",
          },
        },
        "change-1",
      ),
    ).toMatchObject({
      exitCode: 1,
      stdout: {
        error: {
          message:
            "Exactly one safe push destination could not be validated for the selected publication remote.",
          evidence: { reason: "unavailable" },
        },
        help: [
          "Correct the selected publication remote's effective push destination, then retry Submit.",
        ],
      },
    });
  });
});
