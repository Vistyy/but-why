import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { readCurrentPassingValidationEvidenceForChanges } from "../../change/adapters/sqlite/sqlitePassingValidationEvidence.js";
import { publicChangeId } from "../../change/changeId.js";
import { decodePersisted } from "../../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";
import { internalTaskId, publicTaskIdFromInternal } from "../../task/taskId.js";
import type { TaskChangeProjection } from "../inspectTaskChange.js";

const projectionBatchSize = 500;

type StoredTaskChangeProjectionRow = {
  readonly taskId: number;
  readonly changeId: number | null;
  readonly acceptanceContext: unknown;
  readonly closeReason: unknown;
  readonly activeBlockers: number;
};

type DecodedTaskChangeProjectionRow = {
  readonly taskId: number;
  readonly changeId: string;
  readonly acceptanceContext: unknown;
  readonly closeReason: unknown;
  readonly activeBlockers: number;
};

export const listTaskChangeProjectionsSqlite = (
  sql: SqlClient.SqlClient,
  taskIds: readonly string[],
  idPrefix: string,
) =>
  Effect.gen(function* () {
    const rows: StoredTaskChangeProjectionRow[] = [];
    for (let start = 0; start < taskIds.length; start += projectionBatchSize) {
      const batch = taskIds.slice(start, start + projectionBatchSize);
      const placeholders = batch.map(() => "?").join(", ");
      rows.push(
        ...(yield* sql.unsafe<StoredTaskChangeProjectionRow>(
          `SELECT link.task_id AS taskId,
            changes.id AS changeId,
            changes.initial_acceptance_context AS acceptanceContext,
            changes.close_reason AS closeReason,
            COALESCE(blocker.activeBlockers, 0) AS activeBlockers
           FROM task_change_links AS link
           LEFT JOIN changes ON changes.id = link.change_id
           LEFT JOIN (
             SELECT change_id, COUNT(*) AS activeBlockers
             FROM implementation_blockers
             WHERE resolution_content IS NULL
             GROUP BY change_id
           ) AS blocker ON blocker.change_id = link.change_id
           WHERE link.task_id IN (${placeholders})
           ORDER BY link.task_id ASC`,
          batch.map((taskId) => internalTaskId(taskId, idPrefix)),
        )),
      );
    }

    const decoded = yield* decodePersisted("list Task Change projections", () =>
      rows.flatMap((row): readonly DecodedTaskChangeProjectionRow[] => {
        if (row.changeId === null) return [];
        return [
          {
            taskId: row.taskId,
            changeId: publicChangeId(idPrefix, row.changeId),
            acceptanceContext: row.acceptanceContext,
            closeReason: row.closeReason,
            activeBlockers: row.activeBlockers,
          },
        ];
      }),
    );
    const activityChangeIds = decoded
      .filter((row) => row.closeReason === null && row.activeBlockers === 0)
      .map((row) => row.changeId);
    const currentPassingEvidence = yield* readCurrentPassingValidationEvidenceForChanges(
      sql,
      activityChangeIds,
      idPrefix,
      undefined,
      { excludeActiveValidation: true },
    );

    return yield* decodePersisted("list Task Change projections", () => {
      const projections = new Map<string, TaskChangeProjection>();
      for (const row of decoded) {
        if (row.acceptanceContext === null) {
          throw new Error("Linked Change has no Acceptance Context");
        }
        const changeId = row.changeId;
        const evidence = currentPassingEvidence.get(changeId);
        const activity =
          row.closeReason !== null
            ? undefined
            : row.activeBlockers > 0
              ? "blocked"
              : evidence?.hasActiveValidation === true
                ? "validating"
                : evidence?.currentPassingEvidence !== undefined
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
