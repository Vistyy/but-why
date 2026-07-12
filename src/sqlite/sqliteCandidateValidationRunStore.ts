import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  validateAcceptanceContext,
  acceptanceContextFingerprint,
} from "../validationRun/acceptanceContext.js";
import { validationRunLeaseDurationMs } from "../validationRun/candidateValidationRun.js";
import type {
  AcquireValidationRunLeaseInput,
  AcquireValidationRunLeaseResult,
  CandidateValidationFinding,
  CandidateValidationRunRecord,
  CandidateValidationRunStore,
  CompareCurrentValidationInputsInput,
  CompareCurrentValidationInputsResult,
  CompareValidationInputsInput,
  CurrentValidationState,
  CompareValidationInputsResult,
  RecordValidationEvidenceInput,
  RecordValidationEvidenceResult,
  RecordValidationFindingInput,
  RecordValidationFindingResult,
  RenewValidationRunLeaseInput,
  RenewValidationRunLeaseResult,
  RequestValidationInput,
  RequestValidationResult,
  ValidationCopiedFile,
  ValidationRunEvidence,
  ValidationRunLease,
} from "../validationRun/candidateValidationRun.js";
import { canonicalJson, sha256CanonicalJson } from "../validationRun/canonicalJson.js";
import type { AcceptanceContextSnapshotV1 } from "../validationRun/acceptanceContext.js";
import type { ValidationPolicySnapshotV1 } from "../validationRun/validationPolicySnapshot.js";
import { supersedeActiveCandidateValidationRuns } from "./sqliteCandidateValidationInternals.js";
import { rollbackIfOpen, withStateDatabase, type SqliteStoreInput } from "./connection.js";
import { queryAll, queryOne } from "./query.js";

export const openSqliteCandidateValidationRunStore = (
  input: SqliteStoreInput,
): CandidateValidationRunStore => ({
  requestValidation: (request) =>
    withStateDatabase(input, (database) => requestValidation(database, request)),
  getValidationRunById: (validationRunId) =>
    withStateDatabase(input, (database) => getValidationRunById(database, validationRunId)),
  getCurrentValidationRunForChange: (changeId) =>
    withStateDatabase(input, (database) => getCurrentValidationRunForChange(database, changeId)),
  getCurrentValidationState: (changeId) =>
    withStateDatabase(input, (database) => getCurrentValidationState(database, changeId)),
  listEvidence: (validationRunId) =>
    withStateDatabase(input, (database) => listEvidence(database, validationRunId)),
  listFindings: (validationRunId) =>
    withStateDatabase(input, (database) => listFindings(database, validationRunId)),
  recordFinding: (findingInput) =>
    withStateDatabase(input, (database) => recordFinding(database, findingInput)),
  compareValidationInputs: (comparison) =>
    withStateDatabase(input, (database) => compareValidationInputs(database, comparison)),
  compareCurrentValidationInputs: (comparison) =>
    withStateDatabase(input, (database) => compareCurrentValidationInputs(database, comparison)),
  acquireLease: (leaseInput) =>
    withStateDatabase(input, (database) => acquireLease(database, leaseInput)),
  renewLease: (leaseInput) =>
    withStateDatabase(input, (database) => renewLease(database, leaseInput)),
  recordEvidence: (evidenceInput) =>
    withStateDatabase(input, (database) => recordEvidence(database, evidenceInput)),
});

const requestValidation = (
  database: DatabaseSync,
  input: RequestValidationInput,
): RequestValidationResult => {
  const prepared = prepareValidationRequest(input);
  if (!prepared.ok) return prepared;

  database.exec("BEGIN IMMEDIATE");
  try {
    const target = validationTarget(database, input);
    if (!target.ok) return rollbackWith(database, target);

    const matchingActive = findMatchingActiveRun(database, input, prepared);
    if (matchingActive !== undefined) {
      setCurrent(database, input.changeId, input.candidateId, matchingActive.id, input.now);
      database.exec("COMMIT");
      return { ok: true, kind: "active_reused", run: mapRun(database, matchingActive.id) };
    }

    supersedeActiveCandidateValidationRuns(database, input.changeId, input.now);

    const reusable = findReusableRun(database, input, prepared);
    if (reusable !== undefined) {
      setCurrent(database, input.changeId, input.candidateId, reusable.id, input.now);
      database.exec("COMMIT");
      return { ok: true, kind: "complete_reused", run: mapRun(database, reusable.id) };
    }

    const retryable = findRetryableRun(
      database,
      input.candidateId,
      prepared.policyFingerprint,
      prepared.acceptanceContextKey,
      prepared.copiedFilesFingerprint,
    );

    const runId = createRun(database, input, prepared, retryable?.id);
    setCurrent(database, input.changeId, input.candidateId, runId, input.now);
    database.exec("COMMIT");
    return {
      ok: true,
      kind: retryable === undefined ? "new_created" : "retry_created",
      run: mapRun(database, runId),
    };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

type PreparedValidationRequest = {
  readonly ok: true;
  readonly context: AcceptanceContextSnapshotV1 | null;
  readonly contextFingerprint: string | null;
  readonly copiedFiles: readonly ValidationCopiedFile[];
  readonly copiedFilesFingerprint: string;
  readonly policyFingerprint: string;
  readonly acceptanceContextKey: string;
};

type ValidationTargetResult =
  | { readonly ok: true }
  | Extract<RequestValidationResult, { readonly ok: false }>;

const prepareValidationRequest = (
  input: RequestValidationInput,
): PreparedValidationRequest | Extract<RequestValidationResult, { readonly ok: false }> => {
  const contextResult = validateAcceptanceContext(input.acceptanceContext);
  if (!contextResult.ok) {
    return {
      ok: false,
      code:
        contextResult.code === "empty_acceptance_context"
          ? "empty_acceptance_context"
          : "unsupported_acceptance_context_version",
    };
  }
  const copiedFiles = normalizeCopiedFiles(input.copiedFiles ?? []);
  const context = contextResult.context;
  const contextFingerprint = acceptanceContextFingerprint(context);
  return {
    ok: true,
    context,
    contextFingerprint,
    copiedFiles,
    copiedFilesFingerprint: sha256CanonicalJson(copiedFiles),
    policyFingerprint: sha256CanonicalJson(input.policySnapshot),
    acceptanceContextKey: contextFingerprint ?? "none",
  };
};

const validationTarget = (
  database: DatabaseSync,
  input: RequestValidationInput,
): ValidationTargetResult => {
  const change = queryOne<{ readonly state: "open" | "closed" }>(
    database,
    "SELECT state FROM changes WHERE id = ?",
    [input.changeId],
  );
  if (change === undefined) return { ok: false, code: "change_not_found" };
  if (change.state === "closed") return { ok: false, code: "change_closed" };

  const candidate = queryOne<{ readonly changeId: string }>(
    database,
    "SELECT change_id AS changeId FROM candidates WHERE id = ?",
    [input.candidateId],
  );
  if (candidate === undefined) return { ok: false, code: "candidate_not_found" };
  if (candidate.changeId !== input.changeId) {
    return { ok: false, code: "candidate_change_mismatch" };
  }

  const current = queryOne<{ readonly candidateId: string }>(
    database,
    "SELECT current_candidate_id AS candidateId FROM candidate_validation_state WHERE change_id = ?",
    [input.changeId],
  );
  return current === undefined || current.candidateId === input.candidateId
    ? { ok: true }
    : { ok: false, code: "candidate_not_current" };
};

const findMatchingActiveRun = (
  database: DatabaseSync,
  input: RequestValidationInput,
  prepared: PreparedValidationRequest,
): RunRow | undefined =>
  queryOne<RunRow>(
    database,
    `SELECT ${runColumns} FROM candidate_validation_runs
     WHERE change_id = ? AND state = 'active' AND candidate_id = ?
       AND policy_fingerprint = ? AND acceptance_context_key = ?
       AND copied_files_fingerprint = ?`,
    [
      input.changeId,
      input.candidateId,
      prepared.policyFingerprint,
      prepared.acceptanceContextKey,
      prepared.copiedFilesFingerprint,
    ],
  );

const findReusableRun = (
  database: DatabaseSync,
  input: RequestValidationInput,
  prepared: PreparedValidationRequest,
): RunRow | undefined =>
  queryOne<RunRow>(
    database,
    `SELECT ${runColumns} FROM candidate_validation_runs
     WHERE candidate_id = ? AND state = 'complete'
       AND outcome IN ('passed', 'blocked')
       AND policy_fingerprint = ? AND acceptance_context_key = ?
       AND copied_files_fingerprint = ?
     ORDER BY created_at DESC LIMIT 1`,
    [
      input.candidateId,
      prepared.policyFingerprint,
      prepared.acceptanceContextKey,
      prepared.copiedFilesFingerprint,
    ],
  );

const findRetryableRun = (
  database: DatabaseSync,
  candidateId: string,
  policyFingerprint: string,
  acceptanceContextKey: string,
  copiedFilesFingerprint: string,
): { readonly id: string } | undefined =>
  queryOne<{ readonly id: string }>(
    database,
    `SELECT id FROM candidate_validation_runs
     WHERE candidate_id = ? AND state = 'complete' AND outcome = 'tooling_failed'
       AND policy_fingerprint = ? AND acceptance_context_key = ?
       AND copied_files_fingerprint = ?
     ORDER BY created_at DESC LIMIT 1`,
    [candidateId, policyFingerprint, acceptanceContextKey, copiedFilesFingerprint],
  );

const createRun = (
  database: DatabaseSync,
  input: RequestValidationInput,
  prepared: PreparedValidationRequest,
  sourceRunId: string | undefined,
): string => {
  const runId = randomUUID();
  database
    .prepare(`INSERT INTO candidate_validation_runs (
      id, change_id, candidate_id, task_id, state, outcome,
      policy_snapshot, policy_fingerprint, acceptance_context,
      acceptance_context_fingerprint, acceptance_context_key,
      copied_files_fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      runId,
      input.changeId,
      input.candidateId,
      input.taskId ?? null,
      canonicalJson(input.policySnapshot),
      prepared.policyFingerprint,
      prepared.context === null ? null : canonicalJson(prepared.context),
      prepared.contextFingerprint,
      prepared.acceptanceContextKey,
      prepared.copiedFilesFingerprint,
      input.now,
      input.now,
    );
  for (const copiedFile of prepared.copiedFiles) {
    database
      .prepare(
        "INSERT INTO candidate_validation_run_copied_files (validation_run_id, path, content_sha256) VALUES (?, ?, ?)",
      )
      .run(runId, copiedFile.path, copiedFile.contentSha256);
  }
  if (sourceRunId !== undefined) copyPassedEvidence(database, sourceRunId, runId, input.now);
  return runId;
};

const compareValidationInputs = (
  database: DatabaseSync,
  input: CompareValidationInputsInput,
): CompareValidationInputsResult => {
  const run = queryOne<RunFingerprintRow>(
    database,
    `SELECT candidate_id AS candidateId, policy_fingerprint AS policyFingerprint,
      acceptance_context_fingerprint AS acceptanceContextFingerprint,
      copied_files_fingerprint AS copiedFilesFingerprint
     FROM candidate_validation_runs WHERE id = ?`,
    [input.validationRunId],
  );
  if (run === undefined) return { ok: false, code: "validation_run_not_found" };
  const differences = [
    ...(run.candidateId === input.candidateId ? [] : (["candidate"] as const)),
    ...(run.policyFingerprint === input.policyFingerprint ? [] : (["policy"] as const)),
    ...(run.acceptanceContextFingerprint === input.acceptanceContextFingerprint
      ? []
      : (["acceptance_context"] as const)),
    ...(run.copiedFilesFingerprint === input.copiedFilesFingerprint
      ? []
      : (["copied_files"] as const)),
  ];
  return { ok: true, matches: differences.length === 0, differences };
};

const compareCurrentValidationInputs = (
  database: DatabaseSync,
  input: CompareCurrentValidationInputsInput,
): CompareCurrentValidationInputsResult => {
  const current = queryOne<{ readonly validationRunId: string | null }>(
    database,
    "SELECT current_validation_run_id AS validationRunId FROM candidate_validation_state WHERE change_id = ?",
    [input.changeId],
  );
  if (current?.validationRunId === null || current === undefined) {
    return { ok: false, code: "current_validation_run_not_found" };
  }
  const contextResult = validateAcceptanceContext(input.acceptanceContext);
  if (!contextResult.ok) {
    return { ok: false, code: "validation_run_not_found" };
  }
  const copiedFiles = normalizeCopiedFiles(input.copiedFiles ?? []);
  return compareValidationInputs(database, {
    validationRunId: current.validationRunId,
    candidateId: input.candidateId,
    policyFingerprint: sha256CanonicalJson(input.policySnapshot),
    acceptanceContextFingerprint: acceptanceContextFingerprint(contextResult.context),
    copiedFilesFingerprint: sha256CanonicalJson(copiedFiles),
  });
};

const acquireLease = (
  database: DatabaseSync,
  input: AcquireValidationRunLeaseInput,
): AcquireValidationRunLeaseResult => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = queryOne<{ readonly state: CandidateValidationRunRecord["state"] }>(
      database,
      "SELECT state FROM candidate_validation_runs WHERE id = ?",
      [input.validationRunId],
    );
    if (run === undefined)
      return rollbackWith(database, { ok: false, code: "validation_run_not_found" });
    if (run.state !== "active") {
      return rollbackWith(database, { ok: false, code: "validation_run_not_active" });
    }

    const existing = queryOne<LeaseRow>(
      database,
      "SELECT validation_run_id AS validationRunId, lease_token AS leaseToken, holder_id AS holderId, state, acquired_at AS acquiredAt, renewed_at AS renewedAt, expires_at_ms AS expiresAtMs FROM candidate_validation_run_leases WHERE validation_run_id = ?",
      [input.validationRunId],
    );
    if (existing?.state === "active" && existing.expiresAtMs > input.nowMs) {
      return rollbackWith(database, { ok: false, code: "lease_held" });
    }
    if (existing?.state === "active" && existing.expiresAtMs <= input.nowMs) {
      expireRun(database, input.validationRunId, input.now, existing.leaseToken);
      database.exec("COMMIT");
      return { ok: false, code: "lease_expired_run", retryable: true };
    }

    const lease: ValidationRunLease = {
      validationRunId: input.validationRunId,
      leaseToken: randomUUID(),
      holderId: input.holderId,
      acquiredAt: input.now,
      renewedAt: input.now,
      expiresAtMs: input.nowMs + validationRunLeaseDurationMs,
    };
    database
      .prepare(`INSERT INTO candidate_validation_run_leases (
        validation_run_id, lease_token, holder_id, state, acquired_at, renewed_at, expires_at_ms
      ) VALUES (?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(validation_run_id) DO UPDATE SET
        lease_token = excluded.lease_token, holder_id = excluded.holder_id,
        state = 'active', acquired_at = excluded.acquired_at,
        renewed_at = excluded.renewed_at, expires_at_ms = excluded.expires_at_ms`)
      .run(
        lease.validationRunId,
        lease.leaseToken,
        lease.holderId,
        lease.acquiredAt,
        lease.renewedAt,
        lease.expiresAtMs,
      );
    database.exec("COMMIT");
    return { ok: true, lease };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const renewLease = (
  database: DatabaseSync,
  input: RenewValidationRunLeaseInput,
): RenewValidationRunLeaseResult => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = queryOne<{ readonly state: CandidateValidationRunRecord["state"] }>(
      database,
      "SELECT state FROM candidate_validation_runs WHERE id = ?",
      [input.validationRunId],
    );
    if (run === undefined)
      return rollbackWith(database, { ok: false, code: "validation_run_not_found" });
    if (run.state !== "active")
      return rollbackWith(database, { ok: false, code: "validation_run_not_active" });
    const lease = getLease(database, input.validationRunId);
    if (lease === undefined) return rollbackWith(database, { ok: false, code: "lease_not_found" });
    if (lease.leaseToken !== input.leaseToken)
      return rollbackWith(database, { ok: false, code: "lease_not_found" });
    if (lease.state === "revoked")
      return rollbackWith(database, { ok: false, code: "lease_revoked" });
    if (lease.state === "expired")
      return rollbackWith(database, { ok: false, code: "lease_expired" });
    if (lease.expiresAtMs <= input.nowMs) {
      expireRun(database, input.validationRunId, input.now, input.leaseToken);
      database.exec("COMMIT");
      return { ok: false, code: "lease_expired" };
    }
    const renewed = {
      ...lease,
      renewedAt: input.now,
      expiresAtMs: input.nowMs + validationRunLeaseDurationMs,
    };
    database
      .prepare(
        "UPDATE candidate_validation_run_leases SET renewed_at = ?, expires_at_ms = ? WHERE validation_run_id = ?",
      )
      .run(renewed.renewedAt, renewed.expiresAtMs, input.validationRunId);
    database.exec("COMMIT");
    return { ok: true, lease: renewed };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const recordEvidence = (
  database: DatabaseSync,
  input: RecordValidationEvidenceInput,
): RecordValidationEvidenceResult => {
  let encoded: string;
  try {
    encoded = canonicalJson(input.evidence);
  } catch {
    return { ok: false, code: "invalid_evidence" };
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = queryOne<{ readonly state: CandidateValidationRunRecord["state"] }>(
      database,
      "SELECT state FROM candidate_validation_runs WHERE id = ?",
      [input.validationRunId],
    );
    if (run === undefined)
      return rollbackWith(database, { ok: false, code: "validation_run_not_found" });
    const lease = getLease(database, input.validationRunId);
    if (lease === undefined || lease.leaseToken !== input.leaseToken) {
      return rollbackWith(database, { ok: false, code: "lease_not_found" });
    }
    if (lease.state === "active" && lease.expiresAtMs <= Date.parse(input.now)) {
      expireRun(database, input.validationRunId, input.now, input.leaseToken);
      database.exec("COMMIT");
      return { ok: false, code: "lease_expired" };
    }
    if (lease.state === "revoked" && run.state === "superseded") {
      insertEvidence(database, input, encoded, false);
      database.exec("COMMIT");
      return { ok: true, applied: false };
    }
    if (lease.state !== "active")
      return rollbackWith(database, { ok: false, code: "lease_expired" });
    if (run.state !== "active")
      return rollbackWith(database, { ok: false, code: "validation_run_not_active" });
    insertEvidence(database, input, encoded, true);
    if (input.outcome !== undefined) {
      database
        .prepare(
          "UPDATE candidate_validation_runs SET state = 'complete', outcome = ?, updated_at = ? WHERE id = ? AND state = 'active'",
        )
        .run(input.outcome, input.now, input.validationRunId);
      database
        .prepare(
          "UPDATE candidate_validation_run_leases SET state = 'revoked', renewed_at = ? WHERE validation_run_id = ? AND state = 'active'",
        )
        .run(input.now, input.validationRunId);
    }
    database.exec("COMMIT");
    return { ok: true, applied: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const listFindings = (
  database: DatabaseSync,
  validationRunId: string,
): readonly CandidateValidationFinding[] =>
  queryAll<FindingRow>(
    database,
    "SELECT id, validation_run_id AS validationRunId, phase, producer, title, description, evidence, accepted, created_at AS createdAt FROM candidate_validation_run_findings WHERE validation_run_id = ? ORDER BY created_at, id",
    [validationRunId],
  ).map((row) => ({ ...row, accepted: row.accepted === 1 }));

const recordFinding = (
  database: DatabaseSync,
  input: RecordValidationFindingInput,
): RecordValidationFindingResult => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = queryOne<{ readonly state: CandidateValidationRunRecord["state"] }>(
      database,
      "SELECT state FROM candidate_validation_runs WHERE id = ?",
      [input.validationRunId],
    );
    if (run === undefined)
      return rollbackWith(database, { ok: false, code: "validation_run_not_found" });
    const lease = getLease(database, input.validationRunId);
    if (lease === undefined || lease.leaseToken !== input.leaseToken) {
      return rollbackWith(database, { ok: false, code: "lease_not_found" });
    }
    if (lease.state === "active" && lease.expiresAtMs <= Date.parse(input.now)) {
      expireRun(database, input.validationRunId, input.now, input.leaseToken);
      database.exec("COMMIT");
      return { ok: false, code: "lease_expired" };
    }
    if (lease.state === "revoked" && run.state === "superseded") {
      insertFinding(database, input, false);
      database.exec("COMMIT");
      return { ok: true, applied: false };
    }
    if (lease.state !== "active")
      return rollbackWith(database, { ok: false, code: "lease_revoked" });
    if (run.state !== "active")
      return rollbackWith(database, { ok: false, code: "validation_run_not_active" });

    insertFinding(database, input, true);
    database
      .prepare(
        "UPDATE candidate_validation_runs SET state = 'complete', outcome = 'blocked', updated_at = ? WHERE id = ? AND state = 'active'",
      )
      .run(input.now, input.validationRunId);
    database
      .prepare(
        "UPDATE candidate_validation_run_leases SET state = 'revoked', renewed_at = ? WHERE validation_run_id = ? AND state = 'active'",
      )
      .run(input.now, input.validationRunId);
    database.exec("COMMIT");
    return { ok: true, applied: true };
  } catch (error) {
    rollbackIfOpen(database);
    throw error;
  }
};

const insertFinding = (
  database: DatabaseSync,
  input: RecordValidationFindingInput,
  accepted: boolean,
): void => {
  database
    .prepare(
      "INSERT INTO candidate_validation_run_findings (id, validation_run_id, phase, producer, title, description, evidence, accepted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.id,
      input.validationRunId,
      input.phase,
      input.producer,
      input.title,
      input.description,
      input.evidence,
      accepted ? 1 : 0,
      input.now,
    );
};

const expireRun = (
  database: DatabaseSync,
  validationRunId: string,
  now: string,
  leaseToken: string,
): void => {
  database
    .prepare(
      "UPDATE candidate_validation_runs SET state = 'complete', outcome = 'tooling_failed', updated_at = ? WHERE id = ? AND state = 'active'",
    )
    .run(now, validationRunId);
  database
    .prepare(
      "UPDATE candidate_validation_run_leases SET state = 'expired', renewed_at = ? WHERE validation_run_id = ? AND lease_token = ?",
    )
    .run(now, validationRunId, leaseToken);
  database
    .prepare(
      "INSERT INTO candidate_validation_run_evidence (validation_run_id, lease_token, phase, producer, phase_status, evidence, accepted, created_at) VALUES (?, ?, 'tooling', 'lease', NULL, ?, 1, ?)",
    )
    .run(validationRunId, leaseToken, canonicalJson({ kind: "lease_expired" }), now);
};

const copyPassedEvidence = (
  database: DatabaseSync,
  sourceRunId: string,
  destinationRunId: string,
  now: string,
): void => {
  database
    .prepare(`INSERT INTO candidate_validation_run_evidence (
      validation_run_id, lease_token, phase, producer, phase_status, evidence, accepted, created_at
    )
    SELECT ?, 'reused', phase, producer, phase_status, evidence, accepted, ?
    FROM candidate_validation_run_evidence
    WHERE validation_run_id = ? AND phase_status = 'passed' AND accepted = 1`)
    .run(destinationRunId, now, sourceRunId);
};

const insertEvidence = (
  database: DatabaseSync,
  input: RecordValidationEvidenceInput,
  evidence: string,
  accepted: boolean,
): void => {
  database
    .prepare(
      "INSERT INTO candidate_validation_run_evidence (validation_run_id, lease_token, phase, producer, phase_status, evidence, accepted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.validationRunId,
      input.leaseToken,
      input.phase,
      input.producer ?? "unknown",
      input.phaseStatus ?? null,
      evidence,
      accepted ? 1 : 0,
      input.now,
    );
};

const setCurrent = (
  database: DatabaseSync,
  changeId: string,
  candidateId: string,
  runId: string,
  now: string,
): void => {
  database
    .prepare(`INSERT INTO candidate_validation_state (change_id, current_candidate_id, current_validation_run_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(change_id) DO UPDATE SET current_candidate_id = excluded.current_candidate_id,
        current_validation_run_id = excluded.current_validation_run_id, updated_at = excluded.updated_at`)
    .run(changeId, candidateId, runId, now);
};

const getValidationRunById = (
  database: DatabaseSync,
  validationRunId: string,
): CandidateValidationRunRecord | undefined => {
  const row = queryOne<RunRow>(
    database,
    `SELECT ${runColumns} FROM candidate_validation_runs WHERE id = ?`,
    [validationRunId],
  );
  return row === undefined ? undefined : mapRun(database, row.id);
};

const getCurrentValidationRunForChange = (
  database: DatabaseSync,
  changeId: string,
): CandidateValidationRunRecord | undefined => {
  const row = queryOne<{ readonly validationRunId: string | null }>(
    database,
    "SELECT current_validation_run_id AS validationRunId FROM candidate_validation_state WHERE change_id = ?",
    [changeId],
  );
  return row === undefined || row.validationRunId === null
    ? undefined
    : getValidationRunById(database, row.validationRunId);
};

const getCurrentValidationState = (
  database: DatabaseSync,
  changeId: string,
): CurrentValidationState | undefined =>
  queryOne<CurrentValidationState>(
    database,
    "SELECT change_id AS changeId, current_candidate_id AS candidateId, current_validation_run_id AS validationRunId, updated_at AS updatedAt FROM candidate_validation_state WHERE change_id = ?",
    [changeId],
  );

const listEvidence = (
  database: DatabaseSync,
  validationRunId: string,
): readonly ValidationRunEvidence[] =>
  queryAll<EvidenceRow>(
    database,
    "SELECT sequence, phase, producer, phase_status AS phaseStatus, evidence, accepted, created_at AS createdAt FROM candidate_validation_run_evidence WHERE validation_run_id = ? ORDER BY sequence",
    [validationRunId],
  ).map((row) => ({
    sequence: Number(row.sequence),
    phase: row.phase,
    producer: row.producer,
    phaseStatus: row.phaseStatus,
    evidence: JSON.parse(row.evidence) as unknown,
    accepted: row.accepted === 1,
    createdAt: row.createdAt,
  }));

const mapRun = (database: DatabaseSync, validationRunId: string): CandidateValidationRunRecord => {
  const row = queryOne<RunRow>(
    database,
    `SELECT ${runColumns} FROM candidate_validation_runs WHERE id = ?`,
    [validationRunId],
  );
  if (row === undefined) throw new Error("Candidate Validation Run disappeared");
  const copiedFiles = queryAll<CopiedFileRow>(
    database,
    "SELECT path, content_sha256 AS contentSha256 FROM candidate_validation_run_copied_files WHERE validation_run_id = ? ORDER BY path",
    [validationRunId],
  );
  return {
    id: row.id,
    changeId: row.changeId,
    candidateId: row.candidateId,
    taskId: row.taskId,
    state: row.state,
    outcome: row.outcome,
    policySnapshot: JSON.parse(row.policySnapshot) as ValidationPolicySnapshotV1,
    policyFingerprint: row.policyFingerprint,
    acceptanceContext:
      row.acceptanceContext === null
        ? null
        : (JSON.parse(row.acceptanceContext) as AcceptanceContextSnapshotV1),
    acceptanceContextFingerprint: row.acceptanceContextFingerprint,
    copiedFiles,
    copiedFilesFingerprint: row.copiedFilesFingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const getLease = (database: DatabaseSync, validationRunId: string): LeaseRow | undefined =>
  queryOne<LeaseRow>(
    database,
    "SELECT validation_run_id AS validationRunId, lease_token AS leaseToken, holder_id AS holderId, state, acquired_at AS acquiredAt, renewed_at AS renewedAt, expires_at_ms AS expiresAtMs FROM candidate_validation_run_leases WHERE validation_run_id = ?",
    [validationRunId],
  );

const normalizeCopiedFiles = (
  files: readonly ValidationCopiedFile[],
): readonly ValidationCopiedFile[] =>
  [...files].sort((left, right) => left.path.localeCompare(right.path));

const rollbackWith = <Result>(database: DatabaseSync, result: Result): Result => {
  database.exec("ROLLBACK");
  return result;
};

const runColumns = `id, change_id AS changeId, candidate_id AS candidateId, task_id AS taskId,
  state, outcome, policy_snapshot AS policySnapshot, policy_fingerprint AS policyFingerprint,
  acceptance_context AS acceptanceContext, acceptance_context_fingerprint AS acceptanceContextFingerprint,
  copied_files_fingerprint AS copiedFilesFingerprint, created_at AS createdAt, updated_at AS updatedAt`;

type RunRow = {
  readonly id: string;
  readonly changeId: string;
  readonly candidateId: string;
  readonly taskId: string | null;
  readonly state: CandidateValidationRunRecord["state"];
  readonly outcome: CandidateValidationRunRecord["outcome"];
  readonly policySnapshot: string;
  readonly policyFingerprint: string;
  readonly acceptanceContext: string | null;
  readonly acceptanceContextFingerprint: string | null;
  readonly copiedFilesFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type RunFingerprintRow = {
  readonly candidateId: string;
  readonly policyFingerprint: string;
  readonly acceptanceContextFingerprint: string | null;
  readonly copiedFilesFingerprint: string;
};

type CopiedFileRow = ValidationCopiedFile;

type FindingRow = Omit<CandidateValidationFinding, "accepted"> & {
  readonly accepted: number;
};

type EvidenceRow = {
  readonly sequence: number | bigint;
  readonly phase: string;
  readonly producer: string;
  readonly phaseStatus: "passed" | "incomplete" | null;
  readonly evidence: string;
  readonly accepted: number;
  readonly createdAt: string;
};
type LeaseRow = ValidationRunLease & { readonly state: "active" | "revoked" | "expired" };
