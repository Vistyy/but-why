import type { DatabaseSync } from "node:sqlite";

export const supersedeActiveCandidateValidationRuns = (
  database: DatabaseSync,
  changeId: string,
  now: string,
): void => {
  database
    .prepare(
      "UPDATE candidate_validation_runs SET state = 'superseded', updated_at = ? WHERE change_id = ? AND state = 'active'",
    )
    .run(now, changeId);
  database
    .prepare(
      "UPDATE candidate_validation_run_leases SET state = 'revoked', renewed_at = ? WHERE validation_run_id IN (SELECT id FROM candidate_validation_runs WHERE change_id = ?) AND state = 'active'",
    )
    .run(now, changeId);
};

export const setCurrentCandidate = (
  database: DatabaseSync,
  changeId: string,
  candidateId: string,
  now: string,
  preserveCurrentRun = false,
): void => {
  database
    .prepare(`INSERT INTO candidate_validation_state (
      change_id, current_candidate_id, current_validation_run_id, updated_at
    ) VALUES (?, ?, NULL, ?)
    ON CONFLICT(change_id) DO UPDATE SET
      current_candidate_id = excluded.current_candidate_id,
      current_validation_run_id = CASE WHEN ? = 1 THEN candidate_validation_state.current_validation_run_id ELSE NULL END,
      updated_at = excluded.updated_at`)
    .run(changeId, candidateId, preserveCurrentRun ? 1 : 0, now);
};
