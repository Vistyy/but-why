# Own temporary test workspace lifecycles

## Specification

- `docs/issues/036-establish-effect-adoption-baseline.md`
- `docs/issues/144-migrate-cli-effect-test-helpers.md`

## Behaviors owned

- Each test owns the temporary directories and Git repositories that it creates.
- Temporary test workspaces are released after success, failure, and interruption.
- Test cleanup does not depend on a process-wide mutable registry or a repeated suite hook.

## What to build

Provide one test workspace module that acquires and releases temporary workspaces.
The module must support `@effect/vitest` tests and ordinary process-backed Vitest tests.

Migrate temporary directory and test repository consumers to the test-owned lifecycle.
Remove the global temporary-root registry and its repeated cleanup hooks after every consumer uses the new interface.

Keep domain cleanup behavior separate from test-fixture cleanup.
Validation Workspace, Managed Worktree, and Change cleanup assertions must continue to test their production behavior.

## Primary verification seam

Lifecycle tests acquire a temporary test workspace and verify its release after successful, failed, and interrupted test execution.

## Acceptance criteria

- [ ] Each test that creates a temporary workspace acquires and releases it through the shared test workspace module.
- [ ] The module releases temporary workspaces after successful test execution.
- [ ] The module releases temporary workspaces after failed test execution.
- [ ] The module releases temporary workspaces after interrupted Effect test execution.
- [ ] Effect-driven and process-backed tests use the supported test workspace lifecycle.
- [ ] The global temporary-root registry and repeated cleanup hooks are removed after migration.
- [ ] Production cleanup assertions retain their current behavior and coverage.
- [ ] The default test suite passes without leaked temporary workspaces.

## Blocked by

- `docs/issues/144-migrate-cli-effect-test-helpers.md`
