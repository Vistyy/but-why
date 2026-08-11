import type { ChangePublication } from "../change/change.js";
import { decodeStoredPositiveInteger, decodeStoredString } from "./sqliteChangeValueDecoders.js";

export type SqliteChangePublicationRow = {
  readonly publicationCandidateId: unknown;
  readonly publicationValidationRunId: unknown;
  readonly publicationOwner: unknown;
  readonly publicationRepo: unknown;
  readonly publicationBaseBranch: unknown;
  readonly publicationRemoteName: unknown;
  readonly publicationHeadBranch: unknown;
  readonly publicationExpectedHeadSha: unknown;
  readonly publicationPrNumber: unknown;
  readonly publicationPrUrl: unknown;
};

export const decodeSqliteChangePublication = (
  row: SqliteChangePublicationRow,
): ChangePublication | null => {
  const values = [
    row.publicationCandidateId,
    row.publicationValidationRunId,
    row.publicationOwner,
    row.publicationRepo,
    row.publicationBaseBranch,
    row.publicationRemoteName,
    row.publicationHeadBranch,
    row.publicationExpectedHeadSha,
    row.publicationPrNumber,
    row.publicationPrUrl,
  ];
  if (values.every((value) => value === null)) return null;
  if (values.slice(0, 8).some((value) => value === null)) {
    throw new Error("Change publication relationship is incomplete");
  }
  const prNumber = row.publicationPrNumber;
  const prUrl = row.publicationPrUrl;
  if ((prNumber === null) !== (prUrl === null)) {
    throw new Error("Change publication pull request relationship is incomplete");
  }
  return {
    candidateId: decodeStoredString(row.publicationCandidateId, "Publication Candidate id"),
    validationRunId: decodeStoredString(
      row.publicationValidationRunId,
      "Publication Validation Run id",
    ),
    target: {
      owner: decodeStoredString(row.publicationOwner, "Publication owner"),
      repo: decodeStoredString(row.publicationRepo, "Publication repository"),
      baseBranch: decodeStoredString(row.publicationBaseBranch, "Publication base branch"),
      remoteName: decodeStoredString(row.publicationRemoteName, "Publication remote name"),
    },
    headBranch: decodeStoredString(row.publicationHeadBranch, "Publication head branch"),
    expectedHeadSha: decodeStoredString(
      row.publicationExpectedHeadSha,
      "Publication expected head",
    ),
    pullRequest:
      prNumber === null
        ? null
        : {
            number: decodeStoredPositiveInteger(prNumber, "Publication pull request number"),
            url: decodeStoredString(prUrl, "Publication pull request URL"),
          },
  };
};
