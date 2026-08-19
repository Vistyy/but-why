import { Schema } from "effect";

import {
  type AcceptanceContextSnapshotV1,
  acceptanceContextSnapshotSchema,
} from "../change/validationRun/acceptanceContextSnapshot.js";

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

const decodeAcceptanceContextSnapshot = Schema.decodeUnknownSync(
  Schema.parseJson(acceptanceContextSnapshotSchema),
  { onExcessProperty: "error" },
);

export const decodeSqliteAcceptanceContextSnapshot = (
  encoded: string,
): AcceptanceContextSnapshotV1 => decodeAcceptanceContextSnapshot(encoded);
