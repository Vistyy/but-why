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
  const values = [
    row.publicationCandidateId,
    row.publicationValidationRunId,
    row.publicationOwner,
    row.publicationRepo,
    row.publicationBaseBranch,
    row.publicationRemoteName,
    row.publicationHeadBranch,
    row.publicationExpectedHeadSha,
  ];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error("Stored Change publication marker is incomplete");
  }
  if ((row.publicationPrNumber === null) !== (row.publicationPrUrl === null)) {
    throw new Error("Stored Change pull request identity is incomplete");
  }
  return {
    candidateId: requiredPublicationValue(row.publicationCandidateId),
    validationRunId: requiredPublicationValue(row.publicationValidationRunId),
    target: {
      owner: requiredPublicationValue(row.publicationOwner),
      repo: requiredPublicationValue(row.publicationRepo),
      baseBranch: requiredPublicationValue(row.publicationBaseBranch),
      remoteName: requiredPublicationValue(row.publicationRemoteName),
    },
    headBranch: requiredPublicationValue(row.publicationHeadBranch),
    expectedHeadSha: requiredPublicationValue(row.publicationExpectedHeadSha),
    pullRequest:
      row.publicationPrNumber === null || row.publicationPrUrl === null
        ? null
        : { number: row.publicationPrNumber, url: row.publicationPrUrl },
  };
};

const requiredPublicationValue = (value: string | null): string => {
  if (value === null) throw new Error("Stored Change publication marker is incomplete");
  return value;
};
