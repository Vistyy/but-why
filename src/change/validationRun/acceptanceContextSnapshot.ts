import { Schema } from "effect";

export const acceptanceContextSnapshotSchema = Schema.Struct({
  version: Schema.Literal(1),
  title: Schema.String,
  description: Schema.String,
  comments: Schema.optional(Schema.Array(Schema.String)),
  resolutions: Schema.optional(Schema.Array(Schema.String)),
});

export type AcceptanceContextSnapshotV1 = Schema.Schema.Type<
  typeof acceptanceContextSnapshotSchema
>;
