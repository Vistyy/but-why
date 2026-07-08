import { readFileSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { Schema } from "effect";

const timeoutSecondsSchema = Schema.Number.pipe(Schema.int(), Schema.positive());

const repoValidationSandboxConfigSchema = Schema.Struct({
  mode: Schema.optional(Schema.String),
});

const repoValidationPrepareConfigSchema = Schema.Struct({
  command: Schema.String,
  timeoutSeconds: Schema.optional(timeoutSecondsSchema),
});

const repoCheckConfigSchema = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  timeoutSeconds: Schema.optional(timeoutSecondsSchema),
});

const repoRelativePathSchema = Schema.String.pipe(
  Schema.filter((value) => isRepoRelativePath(value)),
);

const repoValidationWorkspaceConfigSchema = Schema.Struct({
  copyFiles: Schema.Array(repoRelativePathSchema),
});

const repoValidationConfigSchema = Schema.Struct({
  sandbox: Schema.optional(repoValidationSandboxConfigSchema),
  prepare: Schema.optional(repoValidationPrepareConfigSchema),
  checks: Schema.optional(Schema.Array(repoCheckConfigSchema)),
});

const repoConfigSchema = Schema.Struct({
  taskPrefix: Schema.String,
  validation: Schema.optional(repoValidationConfigSchema),
  validationWorkspace: Schema.optional(repoValidationWorkspaceConfigSchema),
});

export type RepoConfig = Schema.Schema.Type<typeof repoConfigSchema>;
export type RepoValidationPrepareConfig = Schema.Schema.Type<
  typeof repoValidationPrepareConfigSchema
>;
export type RepoCheckConfig = Schema.Schema.Type<typeof repoCheckConfigSchema>;

export type ConfigReadResult =
  | {
      readonly ok: true;
      readonly config: RepoConfig;
    }
  | {
      readonly ok: false;
    };

export const readRepoConfig = (path: string): ConfigReadResult => {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    const config = Schema.decodeUnknownSync(repoConfigSchema, { onExcessProperty: "error" })(value);

    return { ok: true, config };
  } catch {
    return { ok: false };
  }
};

export const writeRepoConfig = (path: string, taskPrefix: string): void => {
  writeFileSync(path, `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

function isRepoRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !posix.isAbsolute(value) &&
    !win32.isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..")
  );
}
