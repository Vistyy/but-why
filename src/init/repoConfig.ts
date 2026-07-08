import { readFileSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";

export type RepoConfig = {
  readonly taskPrefix: string;
  readonly validation?: RepoValidationConfig;
  readonly checks?: readonly RepoCheckConfig[];
  readonly validationWorkspace?: RepoValidationWorkspaceConfig;
};

export type RepoValidationConfig = {
  readonly sandbox?: RepoValidationSandboxConfig;
  readonly prepare?: RepoValidationPrepareConfig;
};

export type RepoValidationSandboxConfig = {
  readonly mode?: string;
};

export type RepoValidationPrepareConfig = {
  readonly command: string;
  readonly timeoutSeconds?: number;
};

export type RepoCheckConfig = {
  readonly id: string;
  readonly command: string;
  readonly timeoutSeconds?: number;
};

export type RepoValidationWorkspaceConfig = {
  readonly copyFiles: readonly string[];
};

export type ConfigReadResult =
  | {
      readonly ok: true;
      readonly config: RepoConfig;
    }
  | {
      readonly ok: false;
    };

const repoConfigKeys = new Set(["taskPrefix", "validation", "checks", "validationWorkspace"]);

export const readRepoConfig = (path: string): ConfigReadResult => {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));

    if (!isRepoConfig(value)) {
      return { ok: false };
    }

    return { ok: true, config: value };
  } catch {
    return { ok: false };
  }
};

export const writeRepoConfig = (path: string, taskPrefix: string): void => {
  writeFileSync(path, `${JSON.stringify({ taskPrefix }, null, 2)}\n`);
};

const isRepoConfig = (value: unknown): value is RepoConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  if (!entries.every(([key]) => repoConfigKeys.has(key))) {
    return false;
  }

  if (typeof (value as { readonly taskPrefix?: unknown }).taskPrefix !== "string") {
    return false;
  }

  const validation = (value as { readonly validation?: unknown }).validation;

  if (validation !== undefined && !isValidationConfig(validation)) {
    return false;
  }

  const checks = (value as { readonly checks?: unknown }).checks;

  if (checks !== undefined && !isChecksConfig(checks)) {
    return false;
  }

  const validationWorkspace = (value as { readonly validationWorkspace?: unknown })
    .validationWorkspace;

  if (validationWorkspace !== undefined && !isValidationWorkspaceConfig(validationWorkspace)) {
    return false;
  }

  return true;
};

const isValidationConfig = (value: unknown): value is RepoValidationConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  if (!entries.every(([key]) => key === "sandbox" || key === "prepare")) {
    return false;
  }

  const sandbox = (value as { readonly sandbox?: unknown }).sandbox;

  if (sandbox !== undefined && !isValidationSandboxConfig(sandbox)) {
    return false;
  }

  const prepare = (value as { readonly prepare?: unknown }).prepare;

  return prepare === undefined || isValidationPrepareConfig(prepare);
};

const isValidationSandboxConfig = (value: unknown): value is RepoValidationSandboxConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  return (
    entries.every(([key]) => key === "mode") &&
    ((value as { readonly mode?: unknown }).mode === undefined ||
      typeof (value as { readonly mode?: unknown }).mode === "string")
  );
};

const isValidationPrepareConfig = (value: unknown): value is RepoValidationPrepareConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  if (!entries.every(([key]) => key === "command" || key === "timeoutSeconds")) {
    return false;
  }

  const prepare = value as {
    readonly command?: unknown;
    readonly timeoutSeconds?: unknown;
  };

  return (
    typeof prepare.command === "string" &&
    (prepare.timeoutSeconds === undefined ||
      (typeof prepare.timeoutSeconds === "number" &&
        Number.isInteger(prepare.timeoutSeconds) &&
        prepare.timeoutSeconds > 0))
  );
};

const isChecksConfig = (value: unknown): value is readonly RepoCheckConfig[] =>
  Array.isArray(value) && value.every(isCheckConfig);

const isCheckConfig = (value: unknown): value is RepoCheckConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  if (!entries.every(([key]) => key === "id" || key === "command" || key === "timeoutSeconds")) {
    return false;
  }

  const check = value as {
    readonly id?: unknown;
    readonly command?: unknown;
    readonly timeoutSeconds?: unknown;
  };

  return (
    typeof check.id === "string" &&
    typeof check.command === "string" &&
    (check.timeoutSeconds === undefined ||
      (typeof check.timeoutSeconds === "number" &&
        Number.isInteger(check.timeoutSeconds) &&
        check.timeoutSeconds > 0))
  );
};

const isValidationWorkspaceConfig = (value: unknown): value is RepoValidationWorkspaceConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  return (
    entries.length === 1 &&
    entries[0]?.[0] === "copyFiles" &&
    Array.isArray((value as { readonly copyFiles?: unknown }).copyFiles) &&
    (value as { readonly copyFiles: readonly unknown[] }).copyFiles.every(isRepoRelativePath)
  );
};

const isRepoRelativePath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !posix.isAbsolute(value) &&
  !win32.isAbsolute(value) &&
  !value.split(/[\\/]/).includes("..");
