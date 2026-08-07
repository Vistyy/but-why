import type { ChangePublication } from "../change/change.js";
import { requiredPositiveInteger, requiredString } from "./sqlitePersistenceDecoders.js";

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
  const allEmpty = values.every((value) => value === null);
  if (allEmpty && row.publicationPrNumber === null && row.publicationPrUrl === null) return null;
  if (values.some((value) => value === null)) {
    throw new Error("Stored Change publication marker is incomplete");
  }
  if ((row.publicationPrNumber === null) !== (row.publicationPrUrl === null)) {
    throw new Error("Stored Change pull request identity is incomplete");
  }
  return {
    candidateId: requiredString(row.publicationCandidateId, "Change publication Candidate ID"),
    validationRunId: requiredString(
      row.publicationValidationRunId,
      "Change publication Validation Run ID",
    ),
    target: {
      owner: requiredString(row.publicationOwner, "Change publication owner"),
      repo: requiredString(row.publicationRepo, "Change publication repository"),
      baseBranch: requiredString(row.publicationBaseBranch, "Change publication base branch"),
      remoteName: requiredString(row.publicationRemoteName, "Change publication remote name"),
    },
    headBranch: requiredString(row.publicationHeadBranch, "Change publication head branch"),
    expectedHeadSha: requiredString(
      row.publicationExpectedHeadSha,
      "Change publication expected head SHA",
    ),
    pullRequest:
      row.publicationPrNumber === null || row.publicationPrUrl === null
        ? null
        : {
            number: requiredPositiveInteger(
              row.publicationPrNumber,
              "Change publication pull request number",
            ),
            url: requiredString(row.publicationPrUrl, "Change publication pull request URL"),
          },
  };
};
