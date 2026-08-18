export type ValidationArtifactPhase =
  | "prepare"
  | "checks"
  | "acceptance_review"
  | "specialist_review";

export type ValidationArtifactIdentity = {
  readonly validationRunId: number;
  readonly phase: ValidationArtifactPhase;
  readonly producer: string;
  readonly fileName: string;
};

const artifactRefPattern =
  /^artifact:([1-9][0-9]*)\/(prepare|checks|acceptance_review|specialist_review)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/u;

export const validationArtifactPath = (identity: ValidationArtifactIdentity): string =>
  `${identity.validationRunId}/${identity.phase}/${identity.producer}/${identity.fileName}`;

export const validationArtifactRef = (identity: ValidationArtifactIdentity): string =>
  `artifact:${validationArtifactPath(identity)}`;

export const isValidationArtifactRef = (value: string): boolean => {
  const match = artifactRefPattern.exec(value);
  if (match === null) return false;
  const validationRunId = Number(match[1]);
  return Number.isSafeInteger(validationRunId) && validationRunId > 0;
};
