import type { AcceptanceContextSnapshotV1 } from "../change/validationRun/acceptanceContextSnapshot.js";
import { decodeAcceptanceContextValue, parseSqliteJson } from "./sqlitePersistenceDecoders.js";

export const encodeSqliteAcceptanceContextSnapshot = (
  snapshot: AcceptanceContextSnapshotV1,
): string =>
  JSON.stringify({
    version: 1,
    title: snapshot.title,
    description: snapshot.description,
    ...(snapshot.comments === undefined ? {} : { comments: [...snapshot.comments] }),
    ...(snapshot.resolutions === undefined ? {} : { resolutions: [...snapshot.resolutions] }),
  });

export const decodeSqliteAcceptanceContextSnapshot = (
  encoded: string,
): AcceptanceContextSnapshotV1 =>
  decodeAcceptanceContextValue(parseSqliteJson(encoded, "Acceptance Context Snapshot"));
