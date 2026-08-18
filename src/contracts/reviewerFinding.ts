import { Schema } from "effect";

import { nonBlankStringSchema } from "./agentConfig.js";
import { repoRelativePathSchema } from "./repoConfig.js";

export const reviewerFindingCoreSchema = Schema.Struct({
  title: nonBlankStringSchema,
  description: nonBlankStringSchema,
  evidence: nonBlankStringSchema,
  files: Schema.Array(repoRelativePathSchema),
});

const decodeFindingCore = Schema.decodeUnknownSync(reviewerFindingCoreSchema, {
  onExcessProperty: "error",
});

export const decodeReviewerFindingCore = (value: unknown): ReviewerFindingCore =>
  decodeFindingCore(value);

export type ReviewerFindingCore = Schema.Schema.Type<typeof reviewerFindingCoreSchema>;
