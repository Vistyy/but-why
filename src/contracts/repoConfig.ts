import { posix, win32 } from "node:path";

import { Either, Schema } from "effect";

import { agentProfileSchema, configNameSchema, nonBlankStringSchema } from "./agentConfig.js";
import { contractDiagnostics, formatContractDiagnostics } from "./contractDiagnostics.js";
import { taskPrefixPattern } from "./taskPrefix.js";
import { RepoConfigValidationFailed } from "./configErrors.js";

const taskPrefixSchema = Schema.String.pipe(Schema.pattern(taskPrefixPattern));
const checkIdSchema = Schema.String.pipe(Schema.pattern(/^[a-z0-9][a-z0-9_-]*$/u));
const timeoutSecondsSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
export const repoRelativePathSchema = Schema.String.pipe(
  Schema.filter(isRepoRelativePath, {
    identifier: "repo-relative path",
    message: () => "Expected a repo-relative path without parent traversal",
  }),
);

const reviewerSchema = Schema.Struct({
  agentProfile: Schema.optional(configNameSchema),
  instructionsFile: repoRelativePathSchema,
});

const repoValidationSandboxConfigSchema = Schema.Struct({
  mode: Schema.optional(Schema.Literal("none", "docker", "podman")),
});

const repoPrepareConfigSchema = Schema.Struct({
  command: nonBlankStringSchema,
  timeoutSeconds: Schema.optional(timeoutSecondsSchema),
});

const repoCheckConfigSchema = Schema.Struct({
  id: checkIdSchema,
  command: nonBlankStringSchema,
  timeoutSeconds: Schema.optional(timeoutSecondsSchema),
});

const repoValidationWorkspaceConfigSchema = Schema.Struct({
  copyFiles: Schema.NonEmptyArray(repoRelativePathSchema),
});

const repoValidationConfigSchema = Schema.Struct({
  sandbox: Schema.optional(repoValidationSandboxConfigSchema),
  checks: Schema.optional(Schema.NonEmptyArray(repoCheckConfigSchema)),
});

const repoReviewConfigSchema = Schema.Struct({
  intent: Schema.optional(
    Schema.Struct({
      reviewer: configNameSchema,
    }),
  ),
  quality: Schema.optional(
    Schema.Struct({
      mode: Schema.Literal("sequential", "parallel"),
      reviewers: Schema.NonEmptyArray(configNameSchema),
    }),
  ),
});

const repoConfigSchema = Schema.Struct({
  taskPrefix: taskPrefixSchema,
  prepare: Schema.optional(repoPrepareConfigSchema),
  validation: Schema.optional(repoValidationConfigSchema),
  review: Schema.optional(repoReviewConfigSchema),
  reviewers: Schema.optional(Schema.Record({ key: configNameSchema, value: reviewerSchema })),
  agentProfiles: Schema.optional(
    Schema.Record({ key: configNameSchema, value: agentProfileSchema }),
  ),
  validationWorkspace: Schema.optional(repoValidationWorkspaceConfigSchema),
});

export type RepoConfig = Schema.Schema.Type<typeof repoConfigSchema>;
export type RepoPrepareConfig = Schema.Schema.Type<typeof repoPrepareConfigSchema>;
export type RepoCheckConfig = Schema.Schema.Type<typeof repoCheckConfigSchema>;
export type ReviewerConfig = Schema.Schema.Type<typeof reviewerSchema>;

export const decodeRepoConfig = (
  input: unknown,
  path = ".but-why/config.json",
): Either.Either<RepoConfig, RepoConfigValidationFailed> => {
  const result = Schema.decodeUnknownEither(repoConfigSchema, { onExcessProperty: "error" })(input);

  if (Either.isRight(result)) {
    return Either.right(result.right);
  }

  const diagnostics = contractDiagnostics(result.left, input);
  return Either.left(
    new RepoConfigValidationFailed({
      path,
      diagnostics,
      message: formatContractDiagnostics(diagnostics),
    }),
  );
};

function isRepoRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    !posix.isAbsolute(value) &&
    !win32.isAbsolute(value) &&
    !value.split(/[\\/]/u).includes("..") &&
    !value.includes("\\")
  );
}
