import { describe, expect, it } from "vitest";

import type { ChangeRecord } from "../../src/change/change.js";
import type { ChangeSubmitResult } from "../../src/change/submitChange.js";
import { submitResult } from "../../src/cli/change/submitResult.js";
import type { CliResult } from "../../src/cliResults.js";
import type { StructuredObject } from "../../src/output/structured.js";
import { structuredValue } from "../../src/output/structuredValue.js";

const changeId = "change-1";

const change: ChangeRecord = {
  id: changeId,
  repositoryCommonDirectory: "/repo/.git",
  branchRef: "refs/heads/change-1",
  baseRef: "refs/remotes/origin/main",
  baseRemoteUrl: "https://github.com/acme/repo.git",
  worktreePath: "/repo-worktrees/change-1",
  acceptanceContext: null,
  reviewerConfiguration: { acceptanceReview: null, specialistReviews: [] },
  prepare: null,
  prepareFailure: null,
  publication: null,
  implementationDecisions: [],
  activeBlocker: null,
  cleanup: { state: "complete", blockingReason: null },
  state: "closed",
  closeReason: "completed",
  cancelReason: null,
};

const errorResult = (
  code: string,
  message: string,
  help: readonly string[],
  details?: StructuredObject,
): CliResult => ({
  exitCode: 1,
  stdout: {
    error: { code, message, ...(details ?? {}) },
    help,
  },
});

const genericFailure = (code: string, details?: StructuredObject): CliResult =>
  errorResult(
    code,
    "Change Submit could not validate or publish the current Candidate.",
    ["Inspect the Change, validation evidence, and owned pull request, then retry."],
    details,
  );

const publicationFailure = (code: string): CliResult =>
  errorResult(
    code,
    "Candidate Publication could not be confirmed safely.",
    ["Inspect the pending publication and retry Submit."],
    { changeId },
  );

const remoteFailure = (code: string, details?: StructuredObject): CliResult =>
  errorResult(
    code,
    "Change Submit could not fetch the selected remote Change Base.",
    ["Restore the recorded publication remote and branch, then retry Change Submit."],
    details,
  );

type ChangeSubmitDiscriminant<Result = ChangeSubmitResult> = Result extends ChangeSubmitResult
  ? Result extends { readonly ok: true; readonly status: infer Status extends string }
    ? Status
    : Result extends { readonly ok: false; readonly code: infer Code extends string }
      ? Code
      : never
  : never;

type SubmitContractCases = {
  readonly [Discriminant in ChangeSubmitDiscriminant]: {
    readonly result: ChangeSubmitResult;
    readonly expected: CliResult;
  };
};

const cases = {
  nothing_to_submit: {
    result: { ok: true, status: "nothing_to_submit", changeId },
    expected: {
      exitCode: 0,
      stdout: {
        changeId,
        status: "nothing_to_submit",
        help: [
          "Continue implementation in the Managed Worktree and retry Change Submit, or cancel explicitly.",
          'Run `by change cancel change-1 --reason "<reason>"` to cancel this unchanged Change.',
        ],
      },
    },
  },
  published: {
    result: {
      ok: true,
      status: "published",
      changeId,
      candidateId: 1,
      validationRunId: 1,
      created: true,
      pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
    },
    expected: {
      exitCode: 0,
      stdout: {
        changeId,
        candidateId: 1,
        validationRunId: 1,
        status: "published",
        created: true,
        pullRequest: { number: 42, url: "https://github.test/acme/repo/pull/42" },
      },
    },
  },
  completed: {
    result: { ok: true, status: "completed", change },
    expected: { exitCode: 0, stdout: { status: "completed", change: structuredValue(change) } },
  },
  validation_findings: {
    result: {
      ok: false,
      code: "validation_findings",
      changeId,
      candidateId: 1,
      validationRunId: 1,
      findings: [],
    },
    expected: errorResult(
      "validation_findings",
      "Validation produced blocking Findings.",
      ["Fix the Findings in the Managed Worktree, commit them, then retry Change Submit."],
      {
        changeId,
        candidateId: 1,
        validationRunId: 1,
        findings: [],
        recovery: {
          authority: "change_submit",
          changeId,
          action: "fix_validation_findings",
          instruction:
            "Fix every applicable Finding in the Managed Worktree, commit the fixes, then retry Change Submit.",
          retryCommand: "by change submit change-1",
        },
      },
    ),
  },
  validation_tooling_failed: {
    result: {
      ok: false,
      code: "validation_tooling_failed",
      changeId,
      candidateId: 1,
      validationRunId: 1,
      toolingFailures: [],
    },
    expected: errorResult(
      "validation_tooling_failed",
      "Candidate validation tooling failed.",
      ["Fix the validation tooling failure, then retry Change Submit."],
      {
        changeId,
        candidateId: 1,
        validationRunId: 1,
        toolingFailures: [],
      },
    ),
  },
  submission_in_progress: {
    result: { ok: false, code: "submission_in_progress", changeId, validationRunId: null },
    expected: errorResult(
      "submission_in_progress",
      "Another Submission or cancellation already owns this Change.",
      ["Wait for the other operation to finish, then retry."],
      { changeId },
    ),
  },
  active_validation_run: {
    result: { ok: false, code: "active_validation_run", changeId, validationRunId: 1 },
    expected: errorResult(
      "active_validation_run",
      "Validation Run 1 remains active for this Change.",
      [
        "After stopping every process from the run, execute `by validation-run abandon 1 --reason <reason>`.",
      ],
      { changeId, validationRunId: 1 },
    ),
  },
  change_not_found: {
    result: { ok: false, code: "change_not_found" },
    expected: errorResult("change_not_found", "Change was not found.", [
      "Use a Change ID returned by `by change start`.",
    ]),
  },
  change_not_open: {
    result: { ok: false, code: "change_not_open" },
    expected: errorResult("change_not_open", "Change is closed.", [
      "Use a Change ID returned by `by change start`.",
    ]),
  },
  change_blocked: {
    result: { ok: false, code: "change_blocked" },
    expected: errorResult(
      "change_blocked",
      "Change is blocked by an active Implementation Blocker.",
      [
        "Inspect the existing Implementation Blocker with `by change blocker list change-1`, then report it and wait.",
      ],
      { changeId, blockerCommand: "by change blocker list change-1" },
    ),
  },
  dirty_work: {
    result: { ok: false, code: "dirty_work" },
    expected: errorResult(
      "dirty_work",
      "The Change Managed Worktree has uncommitted Git-visible state.",
      ["Commit or remove the visible changes, then retry Change Submit."],
      {
        changeId,
        recovery: {
          authority: "change_submit",
          changeId,
          action: "resolve_dirty_work",
          instruction: "Commit or remove the Git-visible changes, then retry Change Submit.",
          retryCommand: "by change submit change-1",
        },
      },
    ),
  },
  change_base_not_ancestor: {
    result: {
      ok: false,
      code: "change_base_not_ancestor",
      branchRef: "refs/heads/change-1",
      headSha: "head",
      changeBaseRef: "refs/remotes/origin/main",
      changeBaseSha: "base",
    },
    expected: errorResult(
      "change_base_not_ancestor",
      "The Repository Branch does not contain the freshly fetched Change Base.",
      ["Merge or rebase the Change Base into the Repository Branch, then retry Change Submit."],
      {
        changeId,
        branchRef: "refs/heads/change-1",
        headSha: "head",
        changeBaseRef: "refs/remotes/origin/main",
        changeBaseSha: "base",
        recovery: {
          authority: "change_submit",
          changeId,
          action: "integrate_change_base",
          instruction:
            "Merge or rebase the Change Base into the Repository Branch, then retry Change Submit.",
          retryCommand: "by change submit change-1",
        },
      },
    ),
  },
  current_head_mismatch: {
    result: { ok: false, code: "current_head_mismatch" },
    expected: errorResult(
      "current_head_mismatch",
      "The Managed Worktree branch no longer matches the expected Candidate.",
      ["Restore the expected Candidate head, then retry Submit."],
      { changeId },
    ),
  },
  publication_remote_mismatch: {
    result: { ok: false, code: "publication_remote_mismatch" },
    expected: errorResult(
      "publication_remote_mismatch",
      "The Remote Change Branch or pull request does not match the expected Candidate.",
      ["Inspect and resolve the remote commit or pull request, then retry Submit."],
      { changeId },
    ),
  },
  publication_creation_unconfirmed: {
    result: { ok: false, code: "publication_creation_unconfirmed" },
    expected: publicationFailure("publication_creation_unconfirmed"),
  },
  publication_lookup_ambiguous: {
    result: { ok: false, code: "publication_lookup_ambiguous" },
    expected: publicationFailure("publication_lookup_ambiguous"),
  },
  publication_tooling_failed: {
    result: { ok: false, code: "publication_tooling_failed" },
    expected: publicationFailure("publication_tooling_failed"),
  },
  owned_pull_request_unavailable: {
    result: {
      ok: false,
      code: "owned_pull_request_unavailable",
      changeId,
      reason: "pull_request_unavailable",
    },
    expected: errorResult(
      "owned_pull_request_unavailable",
      "The owned pull request facts are temporarily unavailable.",
      ["Restore GitHub access and the owned pull request, then retry Submit."],
      { changeId, reason: "pull_request_unavailable" },
    ),
  },
  validation_policy_invalid: {
    result: { ok: false, code: "validation_policy_invalid", message: "Policy is invalid." },
    expected: errorResult("validation_policy_invalid", "Policy is invalid.", [
      "Fix Repo Config or Global Config, then retry Change Submit.",
    ]),
  },
  publication_remote_missing: {
    result: { ok: false, code: "publication_remote_missing" },
    expected: remoteFailure("publication_remote_missing"),
  },
  publication_remote_ambiguous: {
    result: { ok: false, code: "publication_remote_ambiguous", remoteNames: ["one", "two"] },
    expected: remoteFailure("publication_remote_ambiguous", { remoteNames: ["one", "two"] }),
  },
  publication_remote_unreachable: {
    result: { ok: false, code: "publication_remote_unreachable", remoteName: "origin" },
    expected: remoteFailure("publication_remote_unreachable", { remoteName: "origin" }),
  },
  remote_default_branch_missing: {
    result: { ok: false, code: "remote_default_branch_missing", remoteName: "origin" },
    expected: remoteFailure("remote_default_branch_missing", { remoteName: "origin" }),
  },
  remote_branch_missing: {
    result: {
      ok: false,
      code: "remote_branch_missing",
      remoteName: "origin",
      branchName: "main",
    },
    expected: remoteFailure("remote_branch_missing", {
      remoteName: "origin",
      branchName: "main",
    }),
  },
  invalid_remote_change_base: {
    result: { ok: false, code: "invalid_remote_change_base", baseRef: "main" },
    expected: remoteFailure("invalid_remote_change_base", { baseRef: "main" }),
  },
  publication_remote_changed: {
    result: {
      ok: false,
      code: "publication_remote_changed",
      remoteName: "origin",
      expectedRemoteUrl: "https://github.com/acme/repo.git",
      actualRemoteUrl: "https://github.com/other/repo.git",
    },
    expected: remoteFailure("publication_remote_changed", {
      remoteName: "origin",
      expectedRemoteUrl: "https://github.com/acme/repo.git",
      actualRemoteUrl: "https://github.com/other/repo.git",
    }),
  },
  reconciliation_rejected: {
    result: {
      ok: false,
      code: "reconciliation_rejected",
      change: { changeId, status: "rejected", rejection: "head_mismatch" },
    },
    expected: genericFailure("reconciliation_rejected", {
      change: { changeId, status: "rejected", rejection: "head_mismatch" },
    }),
  },
  github_target_not_found: {
    result: { ok: false, code: "github_target_not_found" },
    expected: genericFailure("github_target_not_found"),
  },
  github_tooling_error: {
    result: { ok: false, code: "github_tooling_error" },
    expected: genericFailure("github_tooling_error"),
  },
  change_closed: {
    result: { ok: false, code: "change_closed" },
    expected: genericFailure("change_closed"),
  },
  candidate_not_found: {
    result: { ok: false, code: "candidate_not_found" },
    expected: genericFailure("candidate_not_found"),
  },
  candidate_does_not_belong_to_change: {
    result: { ok: false, code: "candidate_does_not_belong_to_change" },
    expected: genericFailure("candidate_does_not_belong_to_change"),
  },
  validation_evidence_invalid: {
    result: { ok: false, code: "validation_evidence_invalid" },
    expected: genericFailure("validation_evidence_invalid"),
  },
  branch_binding_invalid: {
    result: { ok: false, code: "branch_binding_invalid" },
    expected: genericFailure("branch_binding_invalid"),
  },
  commit_history_unavailable: {
    result: { ok: false, code: "commit_history_unavailable" },
    expected: genericFailure("commit_history_unavailable"),
  },
  publication_state_conflict: {
    result: { ok: false, code: "publication_state_conflict" },
    expected: genericFailure("publication_state_conflict"),
  },
  detached_head: {
    result: { ok: false, code: "detached_head" },
    expected: genericFailure("detached_head"),
  },
  unborn_branch: {
    result: { ok: false, code: "unborn_branch" },
    expected: genericFailure("unborn_branch"),
  },
  conflicting_branch_facts: {
    result: { ok: false, code: "conflicting_branch_facts" },
    expected: genericFailure("conflicting_branch_facts"),
  },
  change_from_different_repository: {
    result: { ok: false, code: "change_from_different_repository" },
    expected: genericFailure("change_from_different_repository"),
  },
  change_rebind_not_authorized: {
    result: { ok: false, code: "change_rebind_not_authorized" },
    expected: genericFailure("change_rebind_not_authorized"),
  },
  rebind_requires_change_id: {
    result: { ok: false, code: "rebind_requires_change_id" },
    expected: genericFailure("rebind_requires_change_id"),
  },
  destination_branch_has_history: {
    result: { ok: false, code: "destination_branch_has_history" },
    expected: genericFailure("destination_branch_has_history"),
  },
  invalid_base_ref: {
    result: { ok: false, code: "invalid_base_ref" },
    expected: genericFailure("invalid_base_ref"),
  },
  base_ref_conflict: {
    result: { ok: false, code: "base_ref_conflict" },
    expected: genericFailure("base_ref_conflict"),
  },
  missing_remote_default: {
    result: { ok: false, code: "missing_remote_default" },
    expected: genericFailure("missing_remote_default"),
  },
  ambiguous_remote_default: {
    result: { ok: false, code: "ambiguous_remote_default" },
    expected: genericFailure("ambiguous_remote_default"),
  },
  local_base_unavailable: {
    result: { ok: false, code: "local_base_unavailable" },
    expected: genericFailure("local_base_unavailable"),
  },
  capture_conflict: {
    result: { ok: false, code: "capture_conflict" },
    expected: genericFailure("capture_conflict"),
  },
  git_tooling_error: {
    result: { ok: false, code: "git_tooling_error" },
    expected: genericFailure("git_tooling_error"),
  },
} satisfies SubmitContractCases;

describe("Change Submit result contract", () => {
  for (const [discriminant, contractCase] of Object.entries(cases)) {
    it(`preserves the ${discriminant} response`, () => {
      const actualDiscriminant = contractCase.result.ok
        ? contractCase.result.status
        : contractCase.result.code;
      expect(actualDiscriminant).toBe(discriminant);
      expect(submitResult(contractCase.result, changeId)).toEqual(contractCase.expected);
    });
  }
});
