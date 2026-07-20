# Own temporary test workspace lifecycles

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/144-migrate-cli-effect-test-helpers.md`

## Behaviors owned

- Each test owns the temporary directories and Git repositories that it creates.
- Temporary test workspaces are released after success, failure, and interruption.
- Test cleanup does not depend on a process-wide mutable registry or a repeated suite hook.

## What to build

Provide one test workspace module that owns temporary workspace creation and release.
The interface must support tests that run through `@effect/vitest` and tests that verify process-backed behavior.

Migrate temporary directory and test repository consumers to the test-owned lifecycle.
Remove the global temporary-root registry and its repeated cleanup hooks after every consumer uses the new interface.

Keep domain cleanup behavior separate from test-fixture cleanup.
Validation Workspace, Managed Worktree, and Change cleanup assertions must continue to test their production behavior.

## Primary verification seam

Lifecycle tests acquire a temporary test workspace and verify its release after successful, failed, and interrupted test execution.

## Acceptance criteria

- [ ] Each temporary test workspace has one explicit test owner.
- [ ] Temporary workspace cleanup runs after successful test execution.
- [ ] Temporary workspace cleanup runs after failed test execution.
- [ ] Temporary workspace cleanup runs after interrupted Effect test execution.
- [ ] Effect-driven and process-backed tests use the supported test workspace lifecycle.
- [ ] The global temporary-root registry and repeated cleanup hooks are removed after migration.
- [ ] Production cleanup assertions retain their current behavior and coverage.
- [ ] The default test suite passes without leaked temporary workspaces.

## Blocked by

- `docs/issues/144-migrate-cli-effect-test-helpers.md`
