import type { ChangePublication } from "../change/change.js";

export type SqliteChangePublicationRow = {
  readonly publicationCandidateId: string | null;
  readonly publicationValidationRunId: string | null;
  readonly publicationOwner: string | null;
  readonly publicationRepo: string | null;
  readonly publicationBaseBranch: string | null;
  readonly publicationRemoteName: string | null;
  readonly publicationHeadBranch: string | null;
  readonly publicationExpectedHeadSha: string | null;
  readonly publicationPrNumber: number | null;
  readonly publicationPrUrl: string | null;
};

export const decodeSqliteChangePublication = (
  row: SqliteChangePublicationRow,
): ChangePublication | null => {
  if (row.publicationCandidateId === null) return null;
  return {
    candidateId: row.publicationCandidateId,
    validationRunId: row.publicationValidationRunId as string,
    target: {
      owner: row.publicationOwner as string,
      repo: row.publicationRepo as string,
      baseBranch: row.publicationBaseBranch as string,
      remoteName: row.publicationRemoteName as string,
    },
    headBranch: row.publicationHeadBranch as string,
    expectedHeadSha: row.publicationExpectedHeadSha as string,
    pullRequest:
      row.publicationPrNumber === null
        ? null
        : { number: row.publicationPrNumber, url: row.publicationPrUrl as string },
  };
};
