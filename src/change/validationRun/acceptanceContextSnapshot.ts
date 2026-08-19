import { Schema } from "effect";
import type { ImplementationBlockerHistory } from "../implementationBlocker.js";

export const acceptanceContextSnapshotSchema = Schema.Struct({
  version: Schema.Literal(1),
  title: Schema.String,
  description: Schema.String,
  comments: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  resolutions: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
});

export type AcceptanceContextSnapshotV1 = Schema.Schema.Type<
  typeof acceptanceContextSnapshotSchema
>;

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
