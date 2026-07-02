import { readFileSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";

export type RepoConfig = {
  readonly taskPrefix: string;
  readonly validationWorkspace?: RepoValidationWorkspaceConfig;
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

const repoConfigKeys = new Set(["taskPrefix", "validationWorkspace"]);

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

  const validationWorkspace = (value as { readonly validationWorkspace?: unknown })
    .validationWorkspace;

  if (validationWorkspace === undefined) {
    return true;
  }

  return isValidationWorkspaceConfig(validationWorkspace);
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
