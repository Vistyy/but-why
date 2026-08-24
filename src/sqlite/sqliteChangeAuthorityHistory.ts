import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  ImplementationBlocker,
  ImplementationBlockerHistory,
} from "../change/implementationBlocker.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import { decodePersisted } from "../repositoryRuntime/adapters/sqlite/sqlitePersistedData.js";

export type StoredImplementationDecisionRow = {
  readonly id: number;
  readonly changeId: number;
  readonly choice: string;
  readonly rationale: string;
};

export const decodeImplementationDecisions = (
  rows: readonly StoredImplementationDecisionRow[],
  changeId: string,
  idPrefix: string,
): readonly ImplementationDecision[] =>
  rows
    .map((row): ImplementationDecision => {
      const storedChangeId = publicChangeId(idPrefix, row.changeId);
      if (storedChangeId !== changeId) {
        throw new Error("Implementation Decision belongs to another Change");
      }
      return { ...row, changeId: storedChangeId };
    })
    .sort((left, right) => left.id - right.id);

export const implementationBlockerReadColumns = `
  id, change_id AS changeId, content, source_type AS sourceType,
  source_id AS sourceId, resolution_content AS resolutionContent,
  EXISTS (
    SELECT 1
    FROM stall_detections AS detection
    JOIN validation_runs AS run ON run.id = detection.validation_run_id
    JOIN candidates AS candidate ON candidate.id = run.candidate_id
    WHERE detection.id = implementation_blockers.source_id
      AND candidate.change_id = implementation_blockers.change_id
      AND detection.decision = 'stop'
  ) AS stallDetectionExists
`;

export type StoredImplementationBlockerRow = {
  readonly id: number;
  readonly changeId: number;
  readonly content: string;
  readonly sourceType: string | null;
  readonly sourceId: number | null;
  readonly resolutionContent: string | null;
  readonly stallDetectionExists: number;
};

export const decodeImplementationBlockerHistory = (
  rows: readonly StoredImplementationBlockerRow[],
  changeId: string,
  idPrefix: string,
): ImplementationBlockerHistory => {
  const blockers = rows
    .map((row): ImplementationBlocker => {
      const storedChangeId = publicChangeId(idPrefix, row.changeId);
      if (storedChangeId !== changeId) {
        throw new Error("Implementation Blocker belongs to another Change");
      }
      const source =
        (row.sourceType === null || row.sourceType === "implementer") && row.sourceId === null
          ? { type: "implementer" as const }
          : row.sourceType === "stall_detection" &&
              row.sourceId !== null &&
              row.stallDetectionExists === 1
            ? { type: "stall_detection" as const, stallDetectionId: row.sourceId }
            : (() => {
                throw new Error("Implementation Blocker source is invalid");
              })();
      return {
        id: row.id,
        changeId: storedChangeId,
        content: row.content,
        source,
        resolution:
          row.resolutionContent === null
            ? null
            : { blockerId: row.id, content: row.resolutionContent },
      };
    })
    .sort((left, right) => left.id - right.id);
  const active = blockers.filter((blocker) => blocker.resolution === null);
  if (active.length > 1) throw new Error("Change has more than one active Implementation Blocker");
  return {
    blockers,
    resolutions: blockers.flatMap((blocker) =>
      blocker.resolution === null ? [] : [blocker.resolution],
    ),
    active: active[0] ?? null,
  };
};

export const readImplementationBlockerHistory = (
  sql: SqlClient.SqlClient,
  changeId: string,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    sql.unsafe<StoredImplementationBlockerRow>(
      `SELECT ${implementationBlockerReadColumns}
       FROM implementation_blockers
       WHERE change_id = ?
       ORDER BY id`,
      [internalChangeId(changeId, idPrefix)],
    ),
    (rows) =>
      decodePersisted(operationName, () =>
        decodeImplementationBlockerHistory(rows, changeId, idPrefix),
      ),
  );

export const readImplementationBlockerPrefix = (
  sql: SqlClient.SqlClient,
  changeId: string,
  highestBlockerId: number | null,
  operationName: string,
  idPrefix: string,
) =>
  Effect.flatMap(
    highestBlockerId === null
      ? Effect.succeed([] as readonly StoredImplementationBlockerRow[])
      : sql.unsafe<StoredImplementationBlockerRow>(
          `SELECT ${implementationBlockerReadColumns}
           FROM implementation_blockers
           WHERE change_id = ? AND id <= ?
           ORDER BY id`,
          [internalChangeId(changeId, idPrefix), highestBlockerId],
        ),
    (rows) =>
      decodePersisted(operationName, () => {
        const history = decodeImplementationBlockerHistory(rows, changeId, idPrefix);
        if ((history.blockers.at(-1)?.id ?? null) !== highestBlockerId) {
          throw new Error("Validation Run Blocker high-water identity is unknown");
        }
        return history;
      }),
  );
