import { existsSync } from "node:fs";

import { Effect } from "effect";

import type { RepositoryStorageError } from "../contracts/repositoryStorageError.js";
import { type RepositorySql, repositorySqlLayer } from "../sqlite/repositorySql.js";
import {
  type LocalRepositoryContext,
  type LocalRepositorySubmissionContext,
  type ResolveLocalRepositoryError,
  resolveLocalRepository,
  resolveLocalRepositorySubmission,
} from "./repositoryContext.js";

export type RepositoryRuntimeLoadError = ResolveLocalRepositoryError;
export type SubmissionRepositoryRuntimeLoadError =
  | Exclude<ResolveLocalRepositoryError, { readonly code: "state_store_unavailable" }>
  | { readonly code: "state_store_unavailable" };

export type RepositoryRuntime<Context> = {
  readonly context: Context;
  readonly provide: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryStorageError, Exclude<R, RepositorySql>>;
};

const runtimeFor = <Context extends LocalRepositorySubmissionContext>(
  context: Context,
): RepositoryRuntime<Context> => {
  const layer = repositorySqlLayer({
    statePath: context.paths.statePath,
    commonDirectory: context.commonDirectory,
    idPrefix: context.idPrefix,
    lifecycle: "open",
  });
  return {
    context,
    provide: (effect) => effect.pipe(Effect.provide(layer)),
  };
};

export const openRepositoryRuntime = (
  cwd: string,
):
  | { readonly ok: true; readonly runtime: RepositoryRuntime<LocalRepositoryContext> }
  | { readonly ok: false; readonly error: RepositoryRuntimeLoadError } => {
  const resolved = resolveLocalRepository(cwd);
  if (!resolved.ok) return resolved;
  if (!existsSync(resolved.context.paths.statePath)) {
    return {
      ok: false,
      error: {
        code: "state_store_unavailable",
        idPrefix: resolved.context.idPrefix,
      },
    };
  }
  return { ok: true, runtime: runtimeFor(resolved.context) };
};

export const resolveRepositoryIdPrefix = (cwd: string): string | undefined => {
  const resolved = resolveLocalRepository(cwd);
  return resolved.ok ? resolved.context.idPrefix : undefined;
};

export const openSubmissionRepositoryRuntime = (
  cwd: string,
):
  | {
      readonly ok: true;
      readonly runtime: RepositoryRuntime<LocalRepositorySubmissionContext>;
    }
  | { readonly ok: false; readonly error: SubmissionRepositoryRuntimeLoadError } => {
  const resolved = resolveLocalRepositorySubmission(cwd);
  if (!resolved.ok) return resolved;
  if (!existsSync(resolved.context.paths.statePath)) {
    return { ok: false, error: { code: "state_store_unavailable" } };
  }
  return { ok: true, runtime: runtimeFor(resolved.context) };
};
