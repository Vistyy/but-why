import type { ChangePublication } from "../change/change.js";

type EmptySqliteChangePublicationRow = {
  readonly publicationCandidateId: null;
  readonly publicationValidationRunId: null;
  readonly publicationOwner: null;
  readonly publicationRepo: null;
  readonly publicationBaseBranch: null;
  readonly publicationRemoteName: null;
  readonly publicationHeadBranch: null;
  readonly publicationExpectedHeadSha: null;
  readonly publicationPrNumber: null;
  readonly publicationPrUrl: null;
};

type PresentSqliteChangePublicationRow = {
  readonly publicationCandidateId: string;
  readonly publicationValidationRunId: string;
  readonly publicationOwner: string;
  readonly publicationRepo: string;
  readonly publicationBaseBranch: string;
  readonly publicationRemoteName: string;
  readonly publicationHeadBranch: string;
  readonly publicationExpectedHeadSha: string;
} & (
  | { readonly publicationPrNumber: null; readonly publicationPrUrl: null }
  | { readonly publicationPrNumber: number; readonly publicationPrUrl: string }
);

export type SqliteChangePublicationRow =
  | EmptySqliteChangePublicationRow
  | PresentSqliteChangePublicationRow;

export const decodeSqliteChangePublication = (
  row: SqliteChangePublicationRow,
): ChangePublication | null => {
  if (row.publicationCandidateId === null) return null;
  return {
    candidateId: row.publicationCandidateId,
    validationRunId: row.publicationValidationRunId,
    target: {
      owner: row.publicationOwner,
      repo: row.publicationRepo,
      baseBranch: row.publicationBaseBranch,
      remoteName: row.publicationRemoteName,
    },
    headBranch: row.publicationHeadBranch,
    expectedHeadSha: row.publicationExpectedHeadSha,
    pullRequest:
      row.publicationPrNumber === null
        ? null
        : { number: row.publicationPrNumber, url: row.publicationPrUrl },
  };
};
