import {
  decodeReviewerFindingCore,
  type ReviewerFindingCore,
} from "../../contracts/reviewerFinding.js";
import {
  isValidationArtifactRef,
  validationArtifactPath,
  validationArtifactRef,
} from "../../contracts/validationArtifact.js";
import type { ValidationToolingFailureKind } from "../validationRun/toolingErrorKind.js";
import type {
  ValidationRunArtifactRecord,
  ValidationRunFindingRecord,
} from "../validationRun/validationRun.js";

const validationToolingFailureKinds = new Set<string>([
  "snapshot_workspace_setup_failed",
  "infrastructure_tooling_failed",
  "git_tooling_failed",
  "reviewer_process_execution_failed",
  "prepare_command_execution_tooling_failed",
  "check_command_execution_tooling_failed",
  "reviewer_output_contract_failed",
  "token_usage_contract_failed",
] satisfies readonly ValidationToolingFailureKind[]);

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

type ValidationFindingEvidence = ReviewerFindingCore & {
  readonly artifactRefs: readonly string[];
};

export const decodeValidationFindingEvidence = (
  value: unknown,
  availableArtifactRefs: ReadonlySet<string>,
): ValidationFindingEvidence => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Finding is not an object");
  }
  const row = value as Record<string, unknown> & {
    readonly title?: unknown;
    readonly description?: unknown;
    readonly evidence?: unknown;
    readonly files?: unknown;
    readonly artifactRefs?: unknown;
  };
  const fields = ["title", "description", "evidence", "files", "artifactRefs"];
  const keys = Object.keys(row);
  if (keys.length !== fields.length || fields.some((field) => !(field in row))) {
    throw new Error("Finding fields are invalid");
  }
  const artifactRefs = row.artifactRefs;
  if (
    !Array.isArray(artifactRefs) ||
    artifactRefs.some((artifactRef) => typeof artifactRef !== "string")
  ) {
    throw new Error("Finding Artifact references are invalid");
  }
  const title = row.title;
  const description = row.description;
  const evidence = row.evidence;
  const files = row.files;
  const finding = {
    ...decodeReviewerFindingCore({ title, description, evidence, files }),
    artifactRefs: artifactRefs as readonly string[],
  };
  for (const artifactRef of finding.artifactRefs) {
    if (!isValidationArtifactRef(artifactRef)) {
      throw new Error("Finding Artifact reference is invalid");
    }
    if (!availableArtifactRefs.has(artifactRef)) {
      throw new Error("Finding Artifact reference does not resolve within the Validation Run");
    }
  }
  return finding;
};

export const assertValidationFindingEvidence = (
  finding: ValidationRunFindingRecord,
  availableArtifactRefs: ReadonlySet<string>,
): void => {
  decodeValidationFindingEvidence(
    {
      title: finding.title,
      description: finding.description,
      evidence: finding.evidence,
      files: finding.files,
      artifactRefs: finding.artifactRefs,
    },
    availableArtifactRefs,
  );
};

export const assertValidationToolingFailureEvidence = (failure: {
  readonly errorKind: string;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly blockingInvocationId?: number;
}): void => {
  requireNonBlank(failure.errorKind, "Tooling Failure kind");
  if (!validationToolingFailureKinds.has(failure.errorKind)) {
    throw new Error("Tooling Failure kind is unsupported");
  }
  requireNonBlank(failure.operationName, "Tooling Failure operation");
  requireNonBlank(failure.errorMessage, "Tooling Failure message");
  if (failure.blockingInvocationId !== undefined) {
    requireSafePositiveInteger(failure.blockingInvocationId, "Tooling Failure blocking Invocation");
  }
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
