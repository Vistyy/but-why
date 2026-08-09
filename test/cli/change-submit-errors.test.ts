import { describe, expect, it } from "vitest";

import { submitResult } from "../../src/cli/change/submitResult.js";

describe("Change Submit validation-policy errors", () => {
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
          message: "The selected publication remote has no safe push destination.",
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
  });

  it("serializes an exact validation-policy rejection with supplied message and help", () => {
    const result = submitResult(
      {
        ok: false,
        code: "validation_policy_invalid",
        message: 'Agent Profile "missing-reviewer" in repo scope was not found.',
      },
      "change-1",
    );

    expect(result).toEqual({
      exitCode: 1,
      stdout: {
        error: {
          code: "validation_policy_invalid",
          message: 'Agent Profile "missing-reviewer" in repo scope was not found.',
        },
        help: ["Fix Repo Config or Global Config, then retry Change Submit."],
      },
    });
  });

  it("serializes validation-policy path and structured contract diagnostics", () => {
    const result = submitResult(
      {
        ok: false,
        code: "validation_policy_invalid",
        message: "Global Config is invalid.",
        details: {
          path: "/repo/global-config.json",
          diagnostics: [
            {
              path: ["agentProfiles", "implementation", "agentModel"],
              expected: "a Pi runtimeConfig model",
              actual: undefined,
              message: "Required value is missing.",
            },
          ],
        },
      },
      "change-1",
    );

    expect(result).toEqual({
      exitCode: 1,
      stdout: {
        error: {
          code: "validation_policy_invalid",
          message: "Global Config is invalid.",
          path: "/repo/global-config.json",
          diagnostics: [
            {
              path: ["agentProfiles", "implementation", "agentModel"],
              expected: "a Pi runtimeConfig model",
              actual: "<missing>",
              message: "Required value is missing.",
            },
          ],
        },
        help: ["Fix Repo Config or Global Config, then retry Change Submit."],
      },
    });
  });
});
