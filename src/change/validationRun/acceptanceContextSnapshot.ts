import { Schema } from "effect";

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
