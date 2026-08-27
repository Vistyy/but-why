import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { publicChangeId } from "../../../change/changeId.js";
import { decodePersisted } from "../../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { internalTaskId, publicTaskIdFromInternal } from "../../../task/taskId.js";
import type { TaskChangeProjection } from "../../inspectTaskChange.js";

const projectionBatchSize = 500;

type StoredProjectionRow = {
  readonly taskId: number;
  readonly changeId: number | null;
  readonly acceptanceContext: string | null;
  readonly closeReason: string | null;
  readonly activeBlockers: number;
  readonly activeValidations: number;
  readonly passingEvidence: number;
};

export const listTaskChangeProjectionsSqlite = (
  sql: SqlClient.SqlClient,
  taskIds: readonly string[],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows: StoredProjectionRow[] = [];
    for (let start = 0; start < taskIds.length; start += projectionBatchSize) {
      const batch = taskIds.slice(start, start + projectionBatchSize);
      const placeholders = batch.map(() => "?").join(", ");
      rows.push(
        ...(yield* sql.unsafe<StoredProjectionRow>(
          `SELECT link.task_id AS taskId,
            change.id AS changeId,
            change.initial_acceptance_context AS acceptanceContext,
            change.close_reason AS closeReason,
            COALESCE(blocker.activeBlockers, 0) AS activeBlockers,
            COALESCE(validation.activeValidations, 0) AS activeValidations,
            COALESCE(passing.passingEvidence, 0) AS passingEvidence
           FROM task_change_links AS link
           LEFT JOIN changes AS change ON change.id = link.change_id
           LEFT JOIN (
             SELECT change_id, COUNT(*) AS activeBlockers
             FROM implementation_blockers
             WHERE resolution_content IS NULL
             GROUP BY change_id
           ) AS blocker ON blocker.change_id = link.change_id
           LEFT JOIN (
             SELECT candidate.change_id, COUNT(*) AS activeValidations
             FROM validation_runs AS run
             JOIN candidates AS candidate ON candidate.id = run.candidate_id
             WHERE run.outcome IS NULL
             GROUP BY candidate.change_id
           ) AS validation ON validation.change_id = link.change_id
           LEFT JOIN (
             SELECT candidate.change_id, COUNT(*) AS passingEvidence
             FROM candidates AS candidate
             JOIN validation_runs AS run ON run.candidate_id = candidate.id
             WHERE candidate.id = (
               SELECT MAX(latest.id) FROM candidates AS latest
               WHERE latest.change_id = candidate.change_id
             )
               AND run.outcome = 'passed'
             GROUP BY candidate.change_id
           ) AS passing ON passing.change_id = link.change_id
           WHERE link.task_id IN (${placeholders})
           ORDER BY link.task_id ASC`,
          batch.map((taskId) => internalTaskId(taskId, idPrefix)),
        )),
      );
    }

    return yield* decodePersisted("list Task Change projections", () => {
      const projections = new Map<string, TaskChangeProjection | null>();
      for (const row of rows) {
        if (row.changeId === null) {
          projections.set(publicTaskIdFromInternal(row.taskId, idPrefix), null);
          continue;
        }
        const changeId = publicChangeId(idPrefix, row.changeId);
        if (row.acceptanceContext === null) {
          throw new Error("Linked Change has no Acceptance Context");
        }
        if (row.activeValidations > 1) {
          throw new Error("Change has more than one active Validation Run");
        }
        const activity =
          row.closeReason !== null
            ? undefined
            : row.activeBlockers > 0
              ? "blocked"
              : row.activeValidations > 0
                ? "validating"
                : row.passingEvidence > 0
                  ? "ready"
                  : "implementing";
        projections.set(publicTaskIdFromInternal(row.taskId, idPrefix), {
          id: changeId,
          ...(activity === undefined ? {} : { activity }),
        });
      }
      return projections;
    });
  });
