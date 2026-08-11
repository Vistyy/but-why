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
import type { ValidationPhase } from "../change/validationRun/validationRun.js";
import { decodeSqliteCandidateValidationPolicy } from "./sqliteCandidateValidationPolicy.js";
import { decodeSqliteJsonStringArray } from "./sqliteJsonStringArray.js";

export type StoredCandidateRow = {
  readonly id: string;
  readonly changeId: string;
  readonly changeBaseSha: string;
  readonly headSha: string;
  readonly createdAt: string;
};

export const candidateReadColumns = `
  candidate.id, candidate.change_id AS changeId, candidate.change_base_sha AS changeBaseSha,
  candidate.head_sha AS headSha, candidate.created_at AS createdAt
`;

export const decodeCandidate = (row: StoredCandidateRow): CandidateRecord => ({
  id: row.id,
  changeId: row.changeId,
  changeBaseSha: row.changeBaseSha,
  headSha: row.headSha,
  createdAt: row.createdAt,
});

export type StoredValidationRunRow = {
  readonly id: string;
  readonly candidateId: string;
  readonly policySnapshot: string;
  readonly implementationDecisions: string;
  readonly latestResolvedBlockerId: string | null;
  readonly state: CandidateValidationRunRecord["state"];
  readonly outcome: CandidateValidationRunRecord["outcome"];
  readonly createdAt: string;
  readonly updatedAt: string;
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

const decodeValidationRunPolicy = (row: Pick<StoredValidationRunRow, "policySnapshot">) => {
  const policySnapshot = row.policySnapshot;
  return {
    policy: decodeSqliteCandidateValidationPolicy(policySnapshot),
    policySnapshot,
  };
};

export const decodeValidationRun = (row: StoredValidationRunRow): DecodedValidationRun => {
  const { state, outcome } = row;
  const { policy, policySnapshot } = decodeValidationRunPolicy(row);
  const implementationDecisionsSnapshot = row.implementationDecisions;
  return {
    record: {
      id: row.id,
      candidateId: row.candidateId,
      policy,
      implementationDecisions: Schema.decodeUnknownSync(
        Schema.parseJson(implementationDecisionSnapshotSchema),
        { onExcessProperty: "error" },
      )(implementationDecisionsSnapshot),
      state,
      outcome,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    policySnapshot,
    implementationDecisionsSnapshot,
    latestResolvedBlockerId: row.latestResolvedBlockerId,
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

export type StoredActiveValidationRunRow = {
  readonly validationRunId: string;
  readonly changeId: string;
  readonly runId: string;
  readonly runCandidateId: string;
  readonly runState: CandidateValidationRunRecord["state"];
  readonly runOutcome: string | null;
  readonly candidateId: string;
  readonly candidateChangeId: string;
  readonly storedChangeId: string;
};

export const decodeActiveValidationRun = (
  row: StoredActiveValidationRunRow,
  expectedChangeId: string,
): ActiveCandidateValidationRun => {
  const validationRunId = row.validationRunId;
  const changeId = row.changeId;
  const runId = row.runId;
  const runCandidateId = row.runCandidateId;
  const candidateId = row.candidateId;
  const candidateChangeId = row.candidateChangeId;
  const storedChangeId = row.storedChangeId;
  const runState = row.runState;
  const runOutcome = row.runOutcome;
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

export type StoredAbandonmentContextRow = {
  readonly validationRunId: string;
  readonly runCandidateId: string;
  readonly changeId: string;
  readonly storedChangeId: string;
  readonly candidateId: string;
  readonly submittedSha: string;
  readonly setupValidationRunId: string | null;
  readonly setupExpectedCommitSha: string | null;
  readonly worktreePath: string | null;
  readonly cleanupWorkspace: CandidateValidationRunAbandonmentContext["cleanupWorkspace"];
  readonly preNativeRefName: string | null;
  readonly preNativeWorkspacePath: string | null;
  readonly preNativeExpectedCommitSha: string | null;
};

export const decodeAbandonmentContext = (
  row: StoredAbandonmentContextRow,
  expectedValidationRunId: string,
): CandidateValidationRunAbandonmentContext => {
  const validationRunId = row.validationRunId;
  const runCandidateId = row.runCandidateId;
  const candidateId = row.candidateId;
  if (validationRunId !== expectedValidationRunId || runCandidateId !== candidateId) {
    throw new Error("Validation Run abandonment relationship is inconsistent");
  }
  const changeId = row.changeId;
  const storedChangeId = row.storedChangeId;
  if (changeId !== storedChangeId) {
    throw new Error("Validation Run Candidate belongs to an unknown Change");
  }
  const submittedSha = row.submittedSha;
  const setupValidationRunId = row.setupValidationRunId;
  const setupExpectedCommitSha = row.setupExpectedCommitSha;
  if (
    setupValidationRunId !== null &&
    (setupValidationRunId !== validationRunId || setupExpectedCommitSha !== submittedSha)
  ) {
    throw new Error("Snapshot Workspace Setup relationship is inconsistent");
  }
  const cleanupWorkspace = row.cleanupWorkspace;
  if (setupValidationRunId === null && cleanupWorkspace !== null) {
    throw new Error("Validation Run cleanup state has no Snapshot Workspace Setup");
  }
  const worktreePath = row.worktreePath;
  if (setupValidationRunId !== null && (worktreePath === null || cleanupWorkspace === null)) {
    throw new Error("Snapshot Workspace Setup is incomplete");
  }
  const preNativeIdentityParts = [
    row.preNativeRefName,
    row.preNativeWorkspacePath,
    row.preNativeExpectedCommitSha,
  ].filter((value) => value !== null).length;
  if (
    (preNativeIdentityParts !== 0 && preNativeIdentityParts !== 3) ||
    (row.preNativeRefName !== null &&
      (row.preNativeWorkspacePath !== worktreePath ||
        row.preNativeExpectedCommitSha !== submittedSha))
  ) {
    throw new Error("Pre-native Snapshot Workspace cleanup identity is inconsistent");
  }
  return {
    validationRunId,
    changeId,
    candidateId,
    submittedSha,
    ...(worktreePath === null ? {} : { worktreePath }),
    ...(row.preNativeRefName === null ? {} : { preNativeRefName: row.preNativeRefName }),
    cleanupWorkspace,
  };
};

export type StoredValidationRoundRow = {
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly roundNumber: number;
  readonly status: CandidateValidationRound["status"];
  readonly createdAt: string;
};

export const decodeValidationRound = (row: StoredValidationRoundRow): CandidateValidationRound => {
  const phase = row.phase;
  const producer = row.producer;
  const status = row.status;
  return {
    validationRunId: row.validationRunId,
    phase,
    producer,
    roundNumber: row.roundNumber,
    status,
    createdAt: row.createdAt,
  };
};

export type StoredValidationFindingRow = {
  readonly id: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly files: string;
  readonly artifactRefs: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export const findingReadColumns = `
  id, validation_run_id AS validationRunId, phase, producer, title,
  description, evidence, files, artifact_refs AS artifactRefs,
  created_at AS createdAt, updated_at AS updatedAt
`;

export const decodeValidationFinding = (
  row: StoredValidationFindingRow,
): CandidateValidationFinding => {
  const phase = row.phase;
  return {
    id: row.id,
    validationRunId: row.validationRunId,
    phase,
    producer: row.producer,
    title: row.title,
    description: row.description,
    evidence: row.evidence,
    files: decodeSqliteJsonStringArray(row.files),
    artifactRefs: decodeSqliteJsonStringArray(row.artifactRefs),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

export type StoredToolingFailureRow = {
  readonly sequence: number;
  readonly validationRunId: string;
  readonly errorKind: ValidationToolingFailureKind;
  readonly operationName: string;
  readonly errorMessage: string;
  readonly createdAt: string;
};

export const decodeToolingFailure = (
  row: StoredToolingFailureRow,
): CandidateValidationToolingFailure => {
  const errorKind = row.errorKind;
  return {
    sequence: row.sequence,
    validationRunId: row.validationRunId,
    errorKind,
    operationName: row.operationName,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
};

export type StoredValidationArtifactRow = {
  readonly ref: string;
  readonly validationRunId: string;
  readonly phase: ValidationPhase;
  readonly producer: string;
  readonly path: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly truncated: number;
  readonly createdAt: string;
};

export const decodeValidationArtifact = (
  row: StoredValidationArtifactRow,
): CandidateValidationArtifact => {
  const phase = row.phase;
  const { originalBytes, storedBytes } = row;
  const truncated = row.truncated === 1;
  return {
    ref: row.ref,
    validationRunId: row.validationRunId,
    phase,
    producer: row.producer,
    path: row.path,
    originalBytes,
    storedBytes,
    truncated,
    createdAt: row.createdAt,
  };
};

const compareStrings = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;
