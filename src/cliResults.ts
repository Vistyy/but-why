import { type StructuredErrorInput, structuredError } from "./cliError.js";
import type { RepositoryStorageError } from "./contracts/repositoryStorageError.js";
import { structuredContractDiagnostics } from "./output/contractDiagnostics.js";
import type { StructuredObject } from "./output/structured.js";
import type { ResolveLocalRepositoryError } from "./repositoryRuntime/repositoryContext.js";

export type CliResult = CliSuccessResult | CliRuntimeErrorResult | CliUsageErrorResult;

export type CliSuccessResult = {
  readonly exitCode: 0;
  readonly stdout: StructuredObject;
};

export type CliRuntimeErrorResult = {
  readonly exitCode: 1;
  readonly stdout: StructuredObject;
};

export type CliUsageErrorResult = {
  readonly exitCode: 2;
  readonly stdout: StructuredObject;
};

export type RepoStateLoadError =
  | ResolveLocalRepositoryError
  | {
      readonly code: "state_store_unavailable";
      readonly idPrefix?: string;
    };

/**
 * CLI routes should construct serializer-facing results here.
 * Keep JSON serialization outside domain modules and future Snapshot Workspace code.
 */
export const success = (stdout: StructuredObject): CliSuccessResult => ({
  exitCode: 0,
  stdout,
});

export const usageError = (input: StructuredErrorInput): CliUsageErrorResult => ({
  exitCode: 2,
  stdout: structuredError(input),
});

export const runtimeError = (input: StructuredErrorInput): CliRuntimeErrorResult => ({
  exitCode: 1,
  stdout: structuredError(input),
});

export const repoStateLoadError = (error: RepoStateLoadError): CliResult => {
  switch (error.code) {
    case "not_initialized":
      return notInitialized();
    case "main_checkout_unavailable":
      return mainCheckoutUnavailable(error.path);
    case "invalid_repo_config":
      return invalidRepoConfig(error.error);
    case "state_store_unavailable":
      return stateStoreUnavailable(error.idPrefix);
    case "shared_state_identity_conflict":
      return sharedStateIdentityConflict();
    case "id_prefix_conflict":
      return idPrefixConflict(error.configuredIdPrefix, error.storedIdPrefix);
  }
};

const notInitialized = (): CliResult =>
  runtimeError({
    code: "not_initialized",
    message: "This workspace is not initialized for But Why?.",
    help: ["Run `by init --id-prefix BY` in the repository root."],
  });

const mainCheckoutUnavailable = (path: string | undefined): CliResult =>
  runtimeError({
    code: "main_checkout_unavailable",
    message: "The Local Repository's canonical main checkout is unavailable.",
    ...(path === undefined ? {} : { details: { path } }),
    help: ["Restore the canonical main checkout, then retry the command."],
  });

const invalidRepoConfig = (
  error: Extract<ResolveLocalRepositoryError, { readonly code: "invalid_repo_config" }>["error"],
): CliResult =>
  runtimeError({
    code: "invalid_repo_config",
    message: error.message,
    details: {
      path: error.path ?? ".but-why/config.json",
      diagnostics: structuredContractDiagnostics(error.diagnostics),
    },
    help: ["Fix the JSON or run `by init --id-prefix <prefix>` after moving it aside."],
  });

export const stateStoreUnavailable = (idPrefix: string | undefined): CliResult =>
  runtimeError({
    code: "state_store_unavailable",
    message: "Shared But Why? state is unavailable.",
    help: [
      idPrefix === undefined
        ? "Restore <git-common-dir>/but-why/state.sqlite, then run `by init --id-prefix <prefix>`."
        : `Restore <git-common-dir>/but-why/state.sqlite, then run \`by init --id-prefix ${idPrefix}\`.`,
    ],
  });

export const repositoryStorageErrorResult = (
  error: RepositoryStorageError,
  idPrefix?: string,
): CliResult => {
  switch (error._tag) {
    case "RepositoryIdentityConflict":
      return sharedStateIdentityConflict();
    case "RepositoryIdPrefixConflict":
      return idPrefixConflict(error.configuredIdPrefix, error.storedIdPrefix);
    case "RepositoryPersistedDataInvalid":
      return persistedDataInvalid(error.operationName);
    default:
      return stateStoreUnavailable(idPrefix);
  }
};

const persistedDataInvalid = (operation: string): CliResult =>
  runtimeError({
    code: "persisted_data_invalid",
    message: "Shared But Why? state contains malformed persisted data.",
    details: { operation },
    help: [
      "Replace <git-common-dir>/but-why/state.sqlite with a known-good copy, then retry the command.",
    ],
  });

const idPrefixConflict = (configuredIdPrefix: string, storedIdPrefix: string): CliResult =>
  runtimeError({
    code: "id_prefix_conflict",
    message: `Repo Config ID Prefix ${configuredIdPrefix} conflicts with initialized Shared Repository State prefix ${storedIdPrefix}.`,
    details: { configuredIdPrefix, storedIdPrefix },
    help: [`Restore .but-why/config.json to use idPrefix ${storedIdPrefix}, then retry.`],
  });

const sharedStateIdentityConflict = (): CliResult =>
  runtimeError({
    code: "shared_state_identity_conflict",
    message: "Shared But Why? state belongs to a different Git repository.",
    help: ["Restore the repository's own shared state, then run `by init --id-prefix <prefix>`."],
  });
