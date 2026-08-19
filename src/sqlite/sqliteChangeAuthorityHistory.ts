import type * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { internalChangeId, publicChangeId } from "../change/changeId.js";
import type {
  ImplementationBlocker,
  ImplementationBlockerHistory,
} from "../change/implementationBlocker.js";
import type { ImplementationDecision } from "../change/implementationDecision.js";
import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { decodePersisted } from "./sqliteTaskReadModel.js";

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
  id, change_id AS changeId, content, resolution_content AS resolutionContent
`;

export type StoredImplementationBlockerRow = {
  readonly id: number;
  readonly changeId: number;
  readonly content: string;
  readonly resolutionContent: string | null;
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
      return {
        id: row.id,
        changeId: storedChangeId,
        content: row.content,
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

export const latestResolvedBlockerId = (history: ImplementationBlockerHistory): number | null =>
  [...history.blockers]
    .filter((blocker) => blocker.resolution !== null)
    .sort((left, right) => right.id - left.id)[0]?.id ?? null;

export const isValidationRunEligibleForCurrentChangeAuthority = (input: {
  readonly hasAcceptanceContext: boolean;
  readonly runHighestBlockerId: number | null;
  readonly currentHighestBlockerId: number | null;
}): boolean =>
  input.hasAcceptanceContext || input.runHighestBlockerId === input.currentHighestBlockerId;

export const deriveAcceptanceContext = (
  initial: AcceptanceContextSnapshotV1 | null,
  history: ImplementationBlockerHistory,
): AcceptanceContextSnapshotV1 | null => {
  if (initial === null) return null;
  const resolutions = [
    ...(initial.resolutions ?? []),
    ...history.resolutions.map((resolution) => resolution.content),
  ];
  return {
    version: initial.version,
    title: initial.title,
    description: initial.description,
    ...(initial.comments === undefined ? {} : { comments: [...initial.comments] }),
    ...(resolutions.length === 0 ? {} : { resolutions }),
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
