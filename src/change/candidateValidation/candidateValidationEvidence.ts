import {
  validationArtifactPath,
  validationArtifactRef,
} from "../../contracts/validationArtifact.js";
import type {
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";

export const assertValidationArtifactRecord = (artifact: ValidationRunArtifactRecord): void => {
  requireSafePositiveInteger(artifact.validationRunId, "Artifact Validation Run ID");
  requireNonBlank(artifact.producer, "Artifact producer");
  requireNonBlank(artifact.path, "Artifact path");
  requireSafeNonnegativeInteger(artifact.originalBytes, "Artifact original bytes");
  requireSafeNonnegativeInteger(artifact.storedBytes, "Artifact stored bytes");
  if (artifact.storedBytes > artifact.originalBytes) {
    throw new Error("Artifact stored bytes exceed original bytes");
  }
  if (artifact.truncated !== artifact.storedBytes < artifact.originalBytes) {
    throw new Error("Artifact truncation does not match its byte counts");
  }

  const segments = artifact.path.split("/");
  const fileName = segments.length === 4 ? segments[3] : undefined;
  if (fileName === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(fileName)) {
    throw new Error("Artifact path does not contain one valid filename");
  }
  const identity = {
    validationRunId: artifact.validationRunId,
    phase: artifact.phase,
    producer: artifact.producer,
    fileName,
  };
  if (artifact.path !== validationArtifactPath(identity)) {
    throw new Error("Artifact path does not match its Validation Result owner");
  }
  if (artifact.ref !== validationArtifactRef(identity)) {
    throw new Error("Artifact reference does not match its Validation Result owner");
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

const requireSafePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} is invalid`);
};

const requireSafeNonnegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} is invalid`);
};
