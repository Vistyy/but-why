# Migrate Submit, publication, and reconciliation

## Specification

- [Source specification decomposed from Task 146](146-migrate-state-stores-to-effect-programs.md)
- [Taskless Changes and worktree handoff](../specs/taskless-changes-and-worktree-handoff.md)
- [Module-owned storage and Change transactions](../adr/0014-use-module-owned-storage-and-change-transactions.md)

## Behaviors owned

- Change Submit validates and publishes the exact eligible Candidate through Effect-native persistence.
- Publication records owned pull-request state and preserves retry, reservation, and expected-head behavior.
- Reconciliation completes merged Changes, transitions linked Tasks, and records cleanup outcomes atomically.
- Submit and reconciliation receive GitHub target and cleanup operations through narrow injected interfaces.
- Change CLI commands preserve their current argument, error, Finding, and result output.

## What to build

Migrate the remaining Change delivery lifecycle and its callers to the Effect-native storage contract.

Compose GitHub, publication, cleanup, validation, and persistence implementations at the repository edge.
Remove repeated Change transaction and CLI loading behavior only where one shared contract exists.

## Primary verification seam

A cross-process CLI workflow captures a Candidate, submits it, records publication, observes merge state, reconciles the Change, and reads the completed Task and cleanup result.

## Acceptance criteria

- [ ] Submit, publication, and reconciliation use Effect-native persistence.
- [ ] Task-backed and taskless Change behavior remains unchanged.
- [ ] Publication retry, release, ownership, and expected-head protections remain unchanged.
- [ ] Reconciliation atomically records merged Change, linked Task, pull-request, and cleanup state.
- [ ] Supported GitHub remote forms and malformed targets have explicit behavior coverage.
- [ ] Change CLI output and operational error branches are covered.
- [ ] Repository composition supplies GitHub target and cleanup operations to Change workflows.
- [ ] Every production storage caller uses the Effect-native contract required before Task 147.

## Blocked by

- [Task 152](152-migrate-validation-execution-and-history.md)
