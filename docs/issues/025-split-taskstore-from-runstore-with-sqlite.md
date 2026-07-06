# Split TaskStore from RunStore with SQLite still backing both

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Split the current broad durable state seam into a TaskStore seam and a RunStore seam while keeping SQLite as the only implementation.

This is an internal refactor with no user-facing behavior change.

The same SQLite database may back both stores.

A shared private SQLite module or connection may sit underneath both stores.

Shared transactions may exist only in that private SQLite implementation, not as a generic public transaction API.

The public `RepoState` interface must be removed.

`repoState.ts` must stop being a public durable-state seam.

The file may be renamed or reduced to private SQLite plumbing if that is the cleanest implementation.

Do not replace it with another broad generic store name such as StateStore, RepoStore, Storage, or Database.

The important change is that callers depend on the narrower concept they need.

TaskStore should own Task content, Task Context, comments, Task Lifecycle transitions, branch binding, and authority-specific Task behavior.

TaskStore must not read Run data.

TaskStore must not expose validation-workflow-specific methods.

RunStore should own durable Run history and local execution records.

RunStore may store Task identity as a reference, but must not read Task content, Task Context, comments, lifecycle state, or branch binding.

RunStore must not expose submit-workflow-specific methods.

Submit-start may use a temporary cross-store helper where current behavior must atomically touch both TaskStore and RunStore.

That helper must be internal, documented as transitional, and removed by `docs/issues/026-move-validation-start-behind-validationruns.md`.

Tests should cover that the helper preserves current atomic submit-start behavior.

Boundary tooling should allow only that explicit temporary exception, so no other cross-store dependency can spread.

`just quality` must run the relevant Fallow checks so the boundary is enforced by the normal quality gate.

Tests should set up Task and Run scenarios through public seams, not raw SQLite mutation.

Raw SQLite access is allowed only in low-level SQLite implementation, initialization, or migration tests.

This slice should not rename tables or rewrite existing migrations.

No schema migration should be added unless strictly required to preserve compatibility.

This slice should not add remote Task Surfaces, sync, reindexing, or new configuration.

The issue should define store boundaries and forbidden shapes, but does not need to freeze every final method name.

`just quality` must pass before this issue is closed.

## Acceptance criteria

- [ ] Task commands depend on TaskStore behavior rather than a broad mixed state interface.
- [ ] TaskStore does not expose Run reads or depend on RunStore behavior.
- [ ] TaskStore does not expose validation-workflow-specific methods.
- [ ] Run and validation-related code depends on RunStore behavior rather than TaskStore internals.
- [ ] RunStore does not expose Task reads or depend on TaskStore behavior, except for storing Task identity as a reference.
- [ ] RunStore does not expose submit-workflow-specific methods.
- [ ] Any temporary cross-store submit-start helper is internal, clearly marked as transitional, and points to issue 026 for removal.
- [ ] Tests cover that the temporary helper preserves current atomic submit-start behavior.
- [ ] Fallow permits only the explicit temporary submit-start helper to import both TaskStore and RunStore.
- [ ] `just quality` enforces the TaskStore/RunStore boundary through Fallow.
- [ ] SQLite remains the only storage implementation.
- [ ] One SQLite file may still back both TaskStore and RunStore.
- [ ] The public `RepoState` interface is removed.
- [ ] Any shared SQLite code is private implementation detail, not a public `RepoState`-style seam.
- [ ] Shared transactions are not exposed as a generic public transaction API.
- [ ] No new broad generic durable-state seam replaces `RepoState`.
- [ ] Existing SQLite migrations and persistence behavior remain compatible with existing local state.
- [ ] No schema migration is added unless strictly required for compatibility.
- [ ] Existing CLI output, error codes, and behavior remain unchanged.
- [ ] Tests set up Task and Run scenarios through public seams, not raw SQLite mutation.
- [ ] Raw SQLite test access is limited to low-level SQLite implementation, initialization, or migration tests.
- [ ] Direct SQLite implementation details remain hidden from command handlers.
- [ ] Fallow boundary rules enforce that Task code uses TaskStore and Run or validation code uses RunStore, with no direct cross-store imports except the explicit temporary helper.
- [ ] `just quality` passes.
- [ ] No remote Task Surface behavior is added.
- [ ] No local alias behavior is added.

## Blocked by

- `docs/issues/024-make-task-identity-opaque-and-slug-safe.md`
