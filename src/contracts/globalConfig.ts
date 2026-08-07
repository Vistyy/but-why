import { Either, Schema } from "effect";

import {
  agentProfileReferenceSchema,
  agentProfileSchema,
  configNameSchema,
} from "./agentConfig.js";
import { GlobalConfigValidationFailed } from "./configErrors.js";
import { contractDiagnostics, formatContractDiagnostics } from "./contractDiagnostics.js";
import { repoRelativePathSchema } from "./repoConfig.js";

const globalAcceptanceReviewConfigSchema = Schema.Struct({
  agentProfile: Schema.optional(agentProfileReferenceSchema),
  instructionsFile: Schema.optional(repoRelativePathSchema),
});

const globalReviewerSchema = Schema.Struct({
  agentProfile: Schema.optional(agentProfileReferenceSchema),
  instructionsFile: repoRelativePathSchema,
});

const globalDefaultAgentProfileSchema = Schema.Struct({
  scope: Schema.Literal("global"),
  name: configNameSchema,
});

const globalConfigSchema = Schema.Struct({
  defaultAgentProfile: Schema.optional(globalDefaultAgentProfileSchema),
  agentProfiles: Schema.optional(
    Schema.Record({
      key: configNameSchema,
      value: agentProfileSchema,
    }),
  ),
  interactiveSession: Schema.optional(
    Schema.Struct({
      agentProfile: Schema.optional(agentProfileReferenceSchema),
    }),
  ),
  review: Schema.optional(
    Schema.Struct({
      acceptance: Schema.optional(globalAcceptanceReviewConfigSchema),
      specialists: Schema.optional(Schema.Array(configNameSchema)),
    }),
  ),
  reviewers: Schema.optional(
    Schema.Record({
      key: configNameSchema,
      value: globalReviewerSchema,
    }),
  ),
});

export type GlobalConfig = Schema.Schema.Type<typeof globalConfigSchema>;

export const decodeGlobalConfig = (
  input: unknown,
  path = "~/.config/but-why/config.json",
): Either.Either<GlobalConfig, GlobalConfigValidationFailed> => {
  const result = Schema.decodeUnknownEither(globalConfigSchema, { onExcessProperty: "error" })(
    input,
  );

  if (Either.isRight(result)) {
    return Either.right(result.right);
  }

  const diagnostics = contractDiagnostics(result.left, input);
  return Either.left(
    new GlobalConfigValidationFailed({
      path,
      diagnostics,
      message: formatContractDiagnostics(diagnostics),
    }),
  );
};
