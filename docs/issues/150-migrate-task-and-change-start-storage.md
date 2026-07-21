# Migrate Task and Change Start storage

## Specification

- [Source specification decomposed from Task 146](146-migrate-state-stores-to-effect-programs.md)
- [Module-owned storage and Change transactions](../adr/0014-use-module-owned-storage-and-change-transactions.md)
- [Taskless Changes and worktree handoff](../specs/taskless-changes-and-worktree-handoff.md)

## Behaviors owned

- Task creation, comments, dependencies, approval, and lifecycle transitions use Effect-native persistence.
- Change Start atomically checks Task eligibility, creates the Change, records Acceptance Context, and transitions the Task.
- Change Start receives Git operations through an injected Change-owned interface.
- Task dependency failures retain their current command results and diagnostics.
- Task and Change Start transactions preserve current concurrency and rollback behavior.

## What to build

Migrate the Task and Change Start vertical slice to the Effect-native storage contract.

Move Task and Change Start composition to the repository edge.
Keep unmigrated Candidate, validation, submission, and reconciliation callers on the temporary compatibility path.

## Primary verification seam

One CLI process creates and approves a Task, another starts and prepares its Change, and a later process reads the persisted Task state, Change, and Acceptance Context.

## Acceptance criteria

- [ ] Task commands use Effect-native persistence without changing public output.
- [ ] Change Start uses Effect-native persistence and injected Git operations.
- [ ] Starting a Task-backed Change atomically creates the Change and transitions the Task.
- [ ] Task comments and dependency replacement remain safe under concurrent CLI processes.
- [ ] Task dependency errors are covered through their public CLI results.
- [ ] Task approval and transition transactions use the Effect-native Task persistence contract.
- [ ] Repository composition supplies the Change Start Git operations.

## Blocked by

- [Task 149](149-expand-effect-native-storage.md)
