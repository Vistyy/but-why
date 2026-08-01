import { Schema } from "effect";

import { nonBlankStringSchema } from "./agentConfig.js";
import { repoRelativePathSchema } from "./repoConfig.js";

export const reviewerFindingCoreSchema = Schema.Struct({
  title: nonBlankStringSchema,
  description: nonBlankStringSchema,
  evidence: nonBlankStringSchema,
  files: Schema.Array(repoRelativePathSchema),
});

export type ReviewerFindingCore = Schema.Schema.Type<typeof reviewerFindingCoreSchema>;
