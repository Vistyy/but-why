import { readFileSync, writeFileSync } from "node:fs";

import { Either } from "effect";

import type { ContractDiagnostic } from "../contracts/contractDiagnostics.js";
import { formatContractDiagnostics } from "../contracts/contractDiagnostics.js";
import { RepoConfigValidationFailed } from "../contracts/configErrors.js";
import { decodeRepoConfig, type RepoConfig } from "../contracts/repoConfig.js";

export type ConfigReadResult<Config, Failure> =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly error: Failure };

type ConfigDecoder<Config, Failure> = (
  input: unknown,
  path: string,
) => Either.Either<Config, Failure>;

type ConfigFailureFactory<Failure> = (
  path: string,
  diagnostics: readonly ContractDiagnostic[],
) => Failure;

export const readConfigDocument = <Config, Failure>(
  path: string,
  decode: ConfigDecoder<Config, Failure>,
  failure: ConfigFailureFactory<Failure>,
): ConfigReadResult<Config, Failure> => {
  let source: string;

  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    return configReadFailure(
      path,
      "Could not read config.",
      "a readable config file",
      error,
      failure,
    );
  }

  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch (error) {
    return configReadFailure(path, jsonErrorMessage(error), "valid JSON", source, failure);
  }

  const result = decode(value, path);
  return Either.isRight(result)
    ? { ok: true, config: result.right }
    : { ok: false, error: result.left };
};

export const readRepoConfig = (
  path: string,
): ConfigReadResult<RepoConfig, RepoConfigValidationFailed> =>
  readConfigDocument(
    path,
    decodeRepoConfig,
    (sourcePath, diagnostics) =>
      new RepoConfigValidationFailed({
        path: sourcePath,
        diagnostics,
        message: formatContractDiagnostics(diagnostics),
      }),
  );

export const decodeRepoConfigSource = (
  source: string,
  path = ".but-why/config.json",
): ConfigReadResult<RepoConfig, RepoConfigValidationFailed> => {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return configReadFailure(
      path,
      jsonErrorMessage(error),
      "valid JSON",
      source,
      (sourcePath, diagnostics) =>
        new RepoConfigValidationFailed({
          path: sourcePath,
          diagnostics,
          message: formatContractDiagnostics(diagnostics),
        }),
    );
  }
  const result = decodeRepoConfig(value, path);
  return Either.isRight(result)
    ? { ok: true, config: result.right }
    : { ok: false, error: result.left };
};

export const writeRepoConfig = (path: string, taskPrefix: string): void => {
  writeFileSync(path, `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

const configReadFailure = <Config, Failure>(
  path: string,
  message: string,
  expected: string,
  actual: unknown,
  failure: ConfigFailureFactory<Failure>,
): ConfigReadResult<Config, Failure> => {
  const diagnostics: readonly ContractDiagnostic[] = [{ path: [], expected, actual, message }];
  return { ok: false, error: failure(path, diagnostics) };
};

const jsonErrorMessage = (error: unknown): string =>
  error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.";
