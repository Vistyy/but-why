import { Schema } from "effect";
import { acceptanceContextSnapshotSchema } from "../validationRun/acceptanceContextSnapshot.js";

export const validationInputSnapshotSchema = Schema.Struct({
  acceptanceContext: Schema.optional(acceptanceContextSnapshotSchema),
});

export type ValidationInputSnapshot = Schema.Schema.Type<typeof validationInputSnapshotSchema>;
