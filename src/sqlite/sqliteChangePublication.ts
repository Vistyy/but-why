import type { ChangePublication } from "../change/change.js";
import { parseGitHubRemoteUrl } from "../submissionEnvironment/adapters/githubTarget.js";
import { parseRemoteChangeBaseRef } from "../submissionEnvironment/remoteChangeBaseRef.js";
import {
  decodeStoredNullableString,
  decodeStoredPositiveInteger,
  decodeStoredString,
} from "./sqliteChangeValueDecoders.js";

export type SqliteChangePublicationRow = {
  readonly publicationCandidateId: unknown;
  readonly publicationValidationRunId: unknown;
  readonly publicationPrNumber: unknown;
  readonly publicationBaseRef: unknown;
  readonly publicationBaseRemoteUrl: unknown;
  readonly publicationBranchRef: unknown;
  readonly publicationExpectedHeadSha: unknown;
};

export const sqliteChangePublicationColumns = `
  publication.candidate_id AS publicationCandidateId,
  publication.validation_run_id AS publicationValidationRunId,
  publication.pull_request_number AS publicationPrNumber,
  change_row.base_ref AS publicationBaseRef,
  change_row.base_remote_url AS publicationBaseRemoteUrl,
  change_row.branch_ref AS publicationBranchRef,
  publication_candidate.head_commit AS publicationExpectedHeadSha
`;

export const decodeSqliteChangePublication = (
  row: SqliteChangePublicationRow,
): ChangePublication | null => {
  if (row.publicationCandidateId === null) {
    if (
      row.publicationValidationRunId !== null ||
      row.publicationPrNumber !== null ||
      row.publicationExpectedHeadSha !== null
    ) {
      throw new Error("Change publication relationship is incomplete");
    }
    return null;
  }
  const candidateId = decodeStoredPositiveInteger(
    row.publicationCandidateId,
    "Publication Candidate id",
  );
  const validationRunId = decodeStoredPositiveInteger(
    row.publicationValidationRunId,
    "Publication Validation Run id",
  );
  const baseRef = decodeStoredString(row.publicationBaseRef, "Publication Change Base ref");
  const remote = parseRemoteChangeBaseRef(baseRef);
  const repository = parseGitHubRemoteUrl(
    decodeStoredString(row.publicationBaseRemoteUrl, "Publication Change Base remote URL"),
  );
  const branchRef = decodeStoredString(row.publicationBranchRef, "Publication Change branch ref");
  const headBranch = branchRef.startsWith("refs/heads/")
    ? branchRef.slice("refs/heads/".length)
    : undefined;
  if (remote === undefined || repository === undefined || headBranch === undefined) {
    throw new Error("Stored Change publication target is invalid");
  }
  const pullRequestNumber =
    row.publicationPrNumber === null
      ? null
      : decodeStoredPositiveInteger(row.publicationPrNumber, "Publication pull request number");
  return {
    candidateId,
    validationRunId,
    target: {
      owner: repository.owner,
      repo: repository.repo,
      baseBranch: remote.branchName,
      remoteName: remote.remoteName,
    },
    headBranch,
    expectedHeadSha: decodeStoredString(
      row.publicationExpectedHeadSha,
      "Publication expected head",
    ),
    pullRequest:
      pullRequestNumber === null
        ? null
        : {
            number: pullRequestNumber,
            url: `https://github.com/${repository.owner}/${repository.repo}/pull/${pullRequestNumber}`,
          },
  };
};

export const decodeNullablePublicationHead = (value: unknown): string | null =>
  decodeStoredNullableString(value, "Publication expected head");
