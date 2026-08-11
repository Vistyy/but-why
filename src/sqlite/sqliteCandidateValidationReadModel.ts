import { Schema } from "effect";

import type { CandidateRecord } from "../change/candidate/candidate.js";
import type {
  ActiveCandidateValidationRun,
  CandidateValidationArtifact,
  CandidateValidationFinding,
  CandidateValidationRound,
  CandidateValidationRunAbandonmentContext,
  CandidateValidationRunRecord,
  CandidateValidationToolingFailure,
} from "../change/candidateValidation/candidateValidationRunStore.js";
import type { ImplementationBlockerHistory } from "../change/implementationBlocker.js";
import { implementationDecisionSnapshotSchema } from "../change/implementationDecision.js";
import type { ValidationToolingFailureKind } from "../change/validationRun/toolingErrorKind.js";
import { type ValidationPhase, validationPhase } from "../change/validationRun/validationRun.js";
import { decodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";
import {
  decodeStoredNullableString,
  decodeStoredSqlitePositiveInteger,
  decodeStoredString,
} from "./sqliteTaskReadModel.js";

export type UnknownCandidateRow = {
  readonly id: unknown;
  readonly changeId: unknown;
  readonly changeBaseSha: unknown;
  readonly headSha: unknown;
  readonly createdAt: unknown;
};

export const candidateReadColumns = `
  candidate.id, candidate.change_id AS changeId, candidate.change_base_sha AS changeBaseSha,
  candidate.head_sha AS headSha, candidate.created_at AS createdAt
`;

export const decodeCandidate = (row: UnknownCandidateRow): CandidateRecord => ({
  id: decodeStoredString(row.id, "Candidate ID"),
  changeId: decodeStoredString(row.changeId, "Candidate Change ID"),
  changeBaseSha: decodeStoredString(row.changeBaseSha, "Candidate Change Base SHA"),
  headSha: decodeStoredString(row.headSha, "Candidate head SHA"),
  createdAt: decodeStoredString(row.createdAt, "Candidate creation time"),
});

export type UnknownValidationRunRow = {
  readonly id: unknown;
  readonly candidateId: unknown;
  readonly policySnapshot: unknown;
  readonly implementationDecisions: unknown;
  readonly latestResolvedBlockerId: unknown;
  readonly state: unknown;
  readonly outcome: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
};

export const validationRunReadColumns = `
  id, candidate_id AS candidateId, policy_snapshot AS policySnapshot,
  implementation_decisions AS implementationDecisions,
  latest_resolved_blocker_id AS latestResolvedBlockerId,
  state, outcome, created_at AS createdAt, updated_at AS updatedAt
`;

export type DecodedValidationRun = {
  readonly record: CandidateValidationRunRecord;
  readonly policySnapshot: string;
  readonly implementationDecisionsSnapshot: string;
  readonly latestResolvedBlockerId: string | null;
};

const decodeValidationRunPolicy = (row: Pick<UnknownValidationRunRow, "policySnapshot">) => {
  const policySnapshot = decodeStoredString(row.policySnapshot, "Validation Policy Snapshot");
  return {
    policy: decodeSqliteCandidateValidationPolicy(policySnapshot),
    policySnapshot,
  };
};

export const decodeValidationRun = (row: UnknownValidationRunRow): DecodedValidationRun => {
  const state = decodeStoredString(row.state, "Validation Run state");
  if (state !== "running" && state !== "complete") {
    throw new Error("Stored Validation Run state is unsupported");
  }
  const outcome = decodeStoredNullableString(row.outcome, "Validation Run outcome");
  if (
    outcome !== null &&
    outcome !== "passed" &&
    outcome !== "blocked" &&
    outcome !== "tooling_failed"
  ) {
    throw new Error("Stored Validation Run outcome is unsupported");
  }
  if ((state === "running" && outcome !== null) || (state === "complete" && outcome === null)) {
    throw new Error("Stored Validation Run lifecycle relationship is inconsistent");
  }
  const { policy, policySnapshot } = decodeValidationRunPolicy(row);
  const implementationDecisionsSnapshot = decodeStoredString(
    row.implementationDecisions,
    "Implementation Decision Snapshot",
  );
  return {
    record: {
      id: decodeStoredString(row.id, "Validation Run ID"),
      candidateId: decodeStoredString(row.candidateId, "Validation Run Candidate ID"),
      policy,
      implementationDecisions: Schema.decodeUnknownSync(
        Schema.parseJson(implementationDecisionSnapshotSchema),
        { onExcessProperty: "error" },
      )(implementationDecisionsSnapshot),
      state,
      outcome,
      createdAt: decodeStoredString(row.createdAt, "Validation Run creation time"),
      updatedAt: decodeStoredString(row.updatedAt, "Validation Run update time"),
    },
    policySnapshot,
    implementationDecisionsSnapshot,
    latestResolvedBlockerId: decodeStoredNullableString(
      row.latestResolvedBlockerId,
      "Validation Run latest resolved Blocker ID",
    ),
  };
};

export const validateValidationRunAuthorityRelationships = (
  run: DecodedValidationRun,
  changeId: string,
  blockers: ImplementationBlockerHistory,
): void => {
  const expectedLatestResolvedBlockerId = [...blockers.blockers]
    .filter(
      (blocker): blocker is typeof blocker & { readonly resolvedAt: string } =>
        blocker.resolvedAt !== null && blocker.resolvedAt <= run.record.createdAt,
    )
    .sort(
      (left, right) =>
        compareStrings(right.resolvedAt, left.resolvedAt) || right.sequence - left.sequence,
    )[0]?.id;
  validateValidationRunAuthoritySnapshot(run, changeId, expectedLatestResolvedBlockerId ?? null);
};

const validateValidationRunAuthoritySnapshot = (
  run: DecodedValidationRun,
  changeId: string,
  expectedLatestResolvedBlockerId: string | null,
): void => {
  validateValidationRunLatestResolvedBlockerRelationship(run, expectedLatestResolvedBlockerId);
  validateValidationRunImplementationDecisionRelationships(run, changeId);
};

export const validateValidationRunLatestResolvedBlockerRelationship = (
  run: DecodedValidationRun,
  expectedLatestResolvedBlockerId: string | null,
): void => {
  if (run.latestResolvedBlockerId !== expectedLatestResolvedBlockerId) {
    throw new Error("Validation Run latest resolved Blocker identity is inconsistent");
  }
};

export const validateValidationRunImplementationDecisionRelationships = (
  run: DecodedValidationRun,
  changeId: string,
): void => {
  const decisionIds = new Set<string>();
  const decisionSequences = new Set<number>();
  let previousSequence = 0;
  for (const decision of run.record.implementationDecisions) {
    if (decision.changeId !== changeId) {
      throw new Error("Validation Run Implementation Decision belongs to another Change");
    }
    if (!Number.isSafeInteger(decision.sequence) || decision.sequence <= 0) {
      throw new Error(
        "Validation Run Implementation Decision sequence must be a positive safe integer",
      );
    }
    if (
      decisionIds.has(decision.id) ||
      decisionSequences.has(decision.sequence) ||
      decision.sequence <= previousSequence
    ) {
      throw new Error("Validation Run Implementation Decision ordering is inconsistent");
    }
    decisionIds.add(decision.id);
    decisionSequences.add(decision.sequence);
    previousSequence = decision.sequence;
  }
};

export type UnknownActiveValidationRunRow = {
  readonly validationRunId: unknown;
  readonly changeId: unknown;
  readonly runId: unknown;
  readonly runCandidateId: unknown;
  readonly runState: unknown;
  readonly runOutcome: unknown;
  readonly candidateId: unknown;
  readonly candidateChangeId: unknown;
  readonly storedChangeId: unknown;
};

export const decodeActiveValidationRun = (
  row: UnknownActiveValidationRunRow,
  expectedChangeId: string,
): ActiveCandidateValidationRun => {
  const validationRunId = decodeStoredString(row.validationRunId, "Active Validation Run ID");
  const changeId = decodeStoredString(row.changeId, "Active Validation Run Change ID");
  const runId = decodeStoredString(row.runId, "related Validation Run ID");
  const runCandidateId = decodeStoredString(row.runCandidateId, "Validation Run Candidate ID");
  const candidateId = decodeStoredString(row.candidateId, "related Candidate ID");
  const candidateChangeId = decodeStoredString(row.candidateChangeId, "Candidate Change ID");
  const storedChangeId = decodeStoredString(row.storedChangeId, "related Change ID");
  const runState = decodeStoredString(row.runState, "Active Validation Run state");
  const runOutcome = decodeStoredNullableString(row.runOutcome, "Active Validation Run outcome");
  if (
    changeId !== expectedChangeId ||
    candidateChangeId !== changeId ||
    storedChangeId !== changeId
  ) {
    throw new Error("Active Validation Run belongs to another or unknown Change");
  }
  if (
    runId !== validationRunId ||
    runCandidateId !== candidateId ||
    runState !== "running" ||
    runOutcome !== null
  ) {
    throw new Error("Active Validation Run relationship is inconsistent");
  }
  return { validationRunId, changeId };
};

export type UnknownAbandonmentContextRow = {
  readonly validationRunId: unknown;
  readonly runCandidateId: unknown;
  readonly changeId: unknown;
  readonly storedChangeId: unknown;
  readonly candidateId: unknown;
  readonly submittedSha: unknown;
  readonly setupValidationRunId: unknown;
  readonly setupSubmittedSha: unknown;
  readonly setupWorktreeHead: unknown;
  readonly tempRefName: unknown;
  readonly worktreePath: unknown;
  readonly cleanupWorktree: unknown;
  readonly cleanupTempRef: unknown;
};

export const decodeAbandonmentContext = (
  row: UnknownAbandonmentContextRow,
  expectedValidationRunId: string,
): CandidateValidationRunAbandonmentContext => {
  const validationRunId = decodeStoredString(row.validationRunId, "Validation Run ID");
  const runCandidateId = decodeStoredString(row.runCandidateId, "Validation Run Candidate ID");
  const candidateId = decodeStoredString(row.candidateId, "Candidate ID");
  if (validationRunId !== expectedValidationRunId || runCandidateId !== candidateId) {
    throw new Error("Validation Run abandonment relationship is inconsistent");
  }
  const changeId = decodeStoredString(row.changeId, "Candidate Change ID");
  const storedChangeId = decodeStoredString(row.storedChangeId, "related Change ID");
  if (changeId !== storedChangeId) {
    throw new Error("Validation Run Candidate belongs to an unknown Change");
  }
  const submittedSha = decodeStoredString(row.submittedSha, "Candidate submitted SHA");
  const setupValidationRunId = decodeStoredNullableString(
    row.setupValidationRunId,
    "Validation Workspace Setup Run ID",
  );
  const setupSubmittedSha = decodeStoredNullableString(
    row.setupSubmittedSha,
    "Validation Workspace submitted SHA",
  );
  const setupWorktreeHead = decodeStoredNullableString(
    row.setupWorktreeHead,
    "Validation Workspace worktree head",
  );
  if (
    setupValidationRunId !== null &&
    (setupValidationRunId !== validationRunId ||
      setupSubmittedSha !== submittedSha ||
      setupWorktreeHead !== submittedSha)
  ) {
    throw new Error("Validation Workspace Setup relationship is inconsistent");
  }
  const cleanupWorktree = decodeCleanupState(row.cleanupWorktree, "worktree cleanup state");
  const cleanupTempRef = decodeCleanupState(row.cleanupTempRef, "temporary ref cleanup state");
  if (setupValidationRunId === null && (cleanupWorktree !== null || cleanupTempRef !== null)) {
    throw new Error("Validation Run cleanup state has no Workspace Setup");
  }
  const tempRefName = decodeStoredNullableString(row.tempRefName, "Validation temporary ref name");
  const worktreePath = decodeStoredNullableString(row.worktreePath, "Validation Workspace path");
  if (
    setupValidationRunId !== null &&
    (tempRefName === null || cleanupWorktree === null || cleanupTempRef === null)
  ) {
    throw new Error("Validation Workspace Setup is incomplete");
  }
  return {
    validationRunId,
    changeId,
    candidateId,
    submittedSha,
    ...(tempRefName === null ? {} : { tempRefName }),
    ...(worktreePath === null ? {} : { worktreePath }),
    cleanupWorktree,
    cleanupTempRef,
  };
};

export type UnknownValidationRoundRow = {
  readonly validationRunId: unknown;
  readonly phase: unknown;
  readonly producer: unknown;
  readonly roundNumber: unknown;
  readonly roundNumberType: unknown;
  readonly status: unknown;
  readonly createdAt: unknown;
};

export const decodeValidationRound = (row: UnknownValidationRoundRow): CandidateValidationRound => {
  const phase = decodeValidationPhase(row.phase);
  const producer = decodeProducer(row.producer, phase);
  const status = decodeStoredString(row.status, "Validation round status");
  if (status !== "passed" && status !== "failed") {
    throw new Error("Stored Validation round status is unsupported");
  }
  return {
    validationRunId: decodeStoredString(row.validationRunId, "Validation round Run ID"),
    phase,
    producer,
    roundNumber: decodeStoredSqlitePositiveInteger(
      row.roundNumber,
      row.roundNumberType,
      "Validation round number",
    ),
    status,
    createdAt: decodeStoredString(row.createdAt, "Validation round creation time"),
  };
};

export type UnknownValidationFindingRow = {
  readonly id: unknown;
  readonly validationRunId: unknown;
  readonly phase: unknown;
  readonly producer: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly evidence: unknown;
  readonly files: unknown;
  readonly artifactRefs: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
};

export const findingReadColumns = `
  id, validation_run_id AS validationRunId, phase, producer, title,
  description, evidence, files, artifact_refs AS artifactRefs,
  created_at AS createdAt, updated_at AS updatedAt
`;

export const decodeValidationFinding = (
  row: UnknownValidationFindingRow,
): CandidateValidationFinding => {
  const phase = decodeValidationPhase(row.phase);
  return {
    id: decodeStoredString(row.id, "Finding ID"),
    validationRunId: decodeStoredString(row.validationRunId, "Finding Validation Run ID"),
    phase,
    producer: decodeProducer(row.producer, phase),
    title: decodeStoredString(row.title, "Finding title"),
    description: decodeStoredString(row.description, "Finding description"),
    evidence: decodeStoredString(row.evidence, "Finding evidence"),
    files: decodeSqliteJsonStringArray(decodeStoredString(row.files, "Finding files")),
    artifactRefs: decodeSqliteJsonStringArray(
      decodeStoredString(row.artifactRefs, "Finding Artifact references"),
    ),
    createdAt: decodeStoredString(row.createdAt, "Finding creation time"),
    updatedAt: decodeStoredString(row.updatedAt, "Finding update time"),
  };
};

export type UnknownToolingFailureRow = {
  readonly sequence: unknown;
  readonly sequenceType: unknown;
  readonly validationRunId: unknown;
  readonly errorKind: unknown;
  readonly operationName: unknown;
  readonly errorMessage: unknown;
  readonly createdAt: unknown;
};

const toolingFailureKinds = new Set<ValidationToolingFailureKind>([
  "validation_workspace_setup_failed",
  "infrastructure_tooling_failed",
  "git_tooling_failed",
  "reviewer_process_execution_failed",
  "prepare_command_execution_tooling_failed",
  "check_command_execution_tooling_failed",
  "reviewer_output_contract_failed",
  "token_usage_contract_failed",
]);

export const decodeToolingFailure = (
  row: UnknownToolingFailureRow,
): CandidateValidationToolingFailure => {
  const errorKind = decodeStoredString(row.errorKind, "Tooling Failure kind");
  if (!toolingFailureKinds.has(errorKind as ValidationToolingFailureKind)) {
    throw new Error("Stored Tooling Failure kind is unsupported");
  }
  return {
    sequence: decodeStoredSqlitePositiveInteger(
      row.sequence,
      row.sequenceType,
      "Tooling Failure sequence",
    ),
    validationRunId: decodeStoredString(row.validationRunId, "Tooling Failure Validation Run ID"),
    errorKind,
    operationName: decodeStoredString(row.operationName, "Tooling Failure operation name"),
    errorMessage: decodeStoredString(row.errorMessage, "Tooling Failure error message"),
    createdAt: decodeStoredString(row.createdAt, "Tooling Failure creation time"),
  };
};

export type UnknownValidationArtifactRow = {
  readonly ref: unknown;
  readonly validationRunId: unknown;
  readonly phase: unknown;
  readonly producer: unknown;
  readonly path: unknown;
  readonly originalBytes: unknown;
  readonly originalBytesType: unknown;
  readonly storedBytes: unknown;
  readonly storedBytesType: unknown;
  readonly truncated: unknown;
  readonly truncatedType: unknown;
  readonly createdAt: unknown;
};

export const decodeValidationArtifact = (
  row: UnknownValidationArtifactRow,
): CandidateValidationArtifact => {
  const phase = decodeValidationPhase(row.phase);
  const originalBytes = decodeStoredNonnegativeInteger(
    row.originalBytes,
    row.originalBytesType,
    "Artifact original bytes",
  );
  const storedBytes = decodeStoredNonnegativeInteger(
    row.storedBytes,
    row.storedBytesType,
    "Artifact stored bytes",
  );
  const truncated = decodeStoredFlag(row.truncated, row.truncatedType, "Artifact truncation flag");
  if (storedBytes > originalBytes) throw new Error("Stored Artifact bytes exceed original bytes");
  if (truncated !== storedBytes < originalBytes) {
    throw new Error("Stored Artifact truncation relationship is inconsistent");
  }
  return {
    ref: decodeStoredString(row.ref, "Artifact reference"),
    validationRunId: decodeStoredString(row.validationRunId, "Artifact Validation Run ID"),
    phase,
    producer: decodeProducer(row.producer, phase),
    path: decodeStoredString(row.path, "Artifact path"),
    originalBytes,
    storedBytes,
    truncated,
    createdAt: decodeStoredString(row.createdAt, "Artifact creation time"),
  };
};

const decodeValidationPhase = (value: unknown): ValidationPhase => {
  const phase = decodeStoredString(value, "Validation phase");
  if (
    phase !== validationPhase.prepare &&
    phase !== validationPhase.checks &&
    phase !== validationPhase.acceptanceReview &&
    phase !== validationPhase.specialistReview
  ) {
    throw new Error("Stored Validation phase is unsupported");
  }
  return phase;
};

const decodeProducer = (value: unknown, phase: ValidationPhase): string => {
  const producer = decodeStoredString(value, "Validation producer");
  if (phase === validationPhase.prepare && producer !== "prepare") {
    throw new Error("Stored Prepare producer is unsupported");
  }
  if (phase === validationPhase.acceptanceReview && producer !== "acceptance") {
    throw new Error("Stored Acceptance Review producer is unsupported");
  }
  return producer;
};

const decodeCleanupState = (
  value: unknown,
  field: string,
): CandidateValidationRunAbandonmentContext["cleanupWorktree"] => {
  const state = decodeStoredNullableString(value, field);
  if (state !== null && state !== "removed" && state !== "not_created" && state !== "failed") {
    throw new Error(`Stored ${field} is unsupported`);
  }
  return state;
};

const decodeStoredNonnegativeInteger = (
  value: unknown,
  storageType: unknown,
  field: string,
): number => {
  if (storageType !== "integer" || typeof value !== "string") {
    throw new Error(`${field} must be a stored integer`);
  }
  let integer: bigint;
  try {
    integer = BigInt(value);
  } catch {
    throw new Error(`${field} must be a stored integer`);
  }
  const numeric = Number(integer);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`);
  }
  return numeric;
};

const decodeStoredFlag = (value: unknown, storageType: unknown, field: string): boolean => {
  const flag = decodeStoredNonnegativeInteger(value, storageType, field);
  if (flag !== 0 && flag !== 1) throw new Error(`${field} must be zero or one`);
  return flag === 1;
};

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
