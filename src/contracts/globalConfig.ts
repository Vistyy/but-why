import { Either, Schema } from "effect";

import { agentProfileSchema, configNameSchema } from "./agentConfig.js";
import { contractDiagnostics, formatContractDiagnostics } from "./contractDiagnostics.js";
import { GlobalConfigValidationFailed } from "./configErrors.js";
import { repoRelativePathSchema } from "./repoConfig.js";

const globalAcceptanceReviewConfigSchema = Schema.Struct({
  agentProfile: Schema.optional(configNameSchema),
  instructionsFile: Schema.optional(repoRelativePathSchema),
});

const globalConfigSchema = Schema.Struct({
  defaultAgentProfile: Schema.optional(configNameSchema),
  agentProfiles: Schema.optional(
    Schema.Record({
      key: configNameSchema,
      value: agentProfileSchema,
    }),
  ),
  review: Schema.optional(
    Schema.Struct({
      acceptance: Schema.optional(globalAcceptanceReviewConfigSchema),
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
