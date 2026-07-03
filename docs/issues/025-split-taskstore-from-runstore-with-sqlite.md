# Split TaskStore from RunStore with SQLite still backing both

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Split the current broad durable state seam into a TaskStore seam and a RunStore seam while keeping SQLite as the only implementation.

This is an internal refactor with no user-facing behavior change.

The same SQLite database may back both stores.

The important change is that callers depend on the narrower concept they need.

TaskStore should own Task content, Task Context, comments, Task Lifecycle transitions, branch binding, and authority-specific Task behavior.

RunStore should own durable Run history and local execution records.

This slice should not add remote Task Surfaces, sync, reindexing, or new configuration.

## Acceptance criteria

- [ ] Task commands depend on TaskStore behavior rather than a broad mixed state interface.
- [ ] Run and validation-related code depends on RunStore behavior rather than TaskStore internals.
- [ ] SQLite remains the only storage implementation.
- [ ] One SQLite file may still back both TaskStore and RunStore.
- [ ] Existing SQLite migrations and persistence behavior remain compatible with existing local state.
- [ ] Existing CLI output, error codes, and behavior remain unchanged.
- [ ] Tests set up Task and Run scenarios through public seams, not raw SQLite mutation.
- [ ] Direct SQLite implementation details remain hidden from command handlers.
- [ ] No remote Task Surface behavior is added.
- [ ] No local alias behavior is added.

## Blocked by

- `docs/issues/024-make-task-identity-opaque-and-slug-safe.md`
