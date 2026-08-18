import type {
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";

export type ValidationArtifactMetadata = Pick<
  ValidationRunArtifactRecord,
  "path" | "originalBytes" | "storedBytes"
>;

export const assertValidationArtifactMetadata = (artifact: ValidationArtifactMetadata): void => {
  requireNonBlank(artifact.path, "Artifact path");
  requireSafeNonnegativeInteger(artifact.originalBytes, "Artifact original bytes");
  requireSafeNonnegativeInteger(artifact.storedBytes, "Artifact stored bytes");
  if (artifact.storedBytes > artifact.originalBytes) {
    throw new Error("Artifact stored bytes exceed original bytes");
  }
};

export const assertValidationFindingEvidence = (
  finding: Pick<ValidationRunFindingRecord, "title" | "description" | "evidence">,
): void => {
  requireNonBlank(finding.title, "Finding title");
  requireNonBlank(finding.description, "Finding description");
  requireNonBlank(finding.evidence, "Finding evidence");
};

export const assertValidationToolingFailureEvidence = (failure: {
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
}): void => {
  requireNonBlank(failure.errorKind, "Tooling Failure kind");
  requireNonBlank(failure.operationName, "Tooling Failure operation");
  requireNonBlank(failure.errorMessage, "Tooling Failure message");
};

const requireNonBlank = (value: string, name: string): void => {
  if (value.trim().length === 0) throw new Error(`${name} is blank`);
};

const requireSafeNonnegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} is invalid`);
};
