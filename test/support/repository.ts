import { join } from "node:path";

import { Effect } from "effect";

import { type RepositorySql, repositorySqlLayer } from "../../src/sqlite/repositorySql.js";

export const testRepositoryConfig = (root: string) => ({
  commonDirectory: join(root, ".git"),
  statePath: join(root, ".git", "but-why", "state.sqlite"),
});

export const withTestRepository = <A, E, R>(
  root: string,
  program: Effect.Effect<A, E, RepositorySql | R>,
) => Effect.scoped(program.pipe(Effect.provide(repositorySqlLayer(testRepositoryConfig(root)))));
