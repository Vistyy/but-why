import { readFileSync, writeFileSync } from "node:fs";

export type RepoConfig = {
  readonly taskPrefix: string;
};

export type ConfigReadResult =
  | {
      readonly ok: true;
      readonly config: RepoConfig;
    }
  | {
      readonly ok: false;
    };

const repoConfigKeys = new Set(["taskPrefix"]);

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

  return (
    entries.length === 1 &&
    entries.every(([key]) => repoConfigKeys.has(key)) &&
    typeof (value as { readonly taskPrefix?: unknown }).taskPrefix === "string"
  );
};
