# Migrate Task and Change Start storage

## Status

Done.

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

## Scoped implementation record

- Baseline: `5ad27375d28ed3700b61d152490bef39404acbcc`.
- Spec review source: this task draft.
- Normative traceability: Task 146, ADR 0014, `docs/architecture.md`, the Effect-first storage spike, and `docs/specs/taskless-changes-and-worktree-handoff.md`.
- Primary seam: one CLI process creates and approves a Task, another starts and prepares its Change, and a later process reads the persisted Task state, Change, and Acceptance Context.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Task commands use Effect-native persistence without output changes | Task persistence interface, SQLite adapter, Task use cases, and repository composition | Executable Task CLI workflows | Existing structured results and durable state remain unchanged |
| Change Start uses Effect-native persistence and injected Git operations | Change Start persistence interface, SQLite adapter, Change workflow, and Change-owned Git interface | Real-Git Change Start CLI integration | Taskless and Task-backed Change Start retain current results and worktree behavior |
| Task-backed Change Start is atomic | Change Start persistence transaction | Cross-process Task-backed Change Start and SQLite rollback integration | Change creation, Acceptance Context capture, and Task transition commit or roll back together |
| Task comments and dependency replacement remain concurrency-safe | Task persistence write transactions | Concurrent executable Task CLI processes | Every comment remains durable and dependency replacement leaves one complete valid set |
| Task dependency errors retain public results | Task workflow and CLI result mapping | Task dependency and Change Start CLI tests | Structured codes, blocker facts, and diagnostics remain unchanged |
| Task approval and lifecycle transitions use Effect-native persistence | Task persistence interface and SQLite adapter | Task approval and lifecycle CLI tests | Domain results and durable transitions remain unchanged |
| Repository composition supplies Change Start Git operations | Repository-edge Change composition | Change Start orchestration and real-Git CLI tests | The workflow receives its Git operations through the Change-owned interface |

Required verification is `nix develop -c just quality` plus focused Task CLI, Task dependency, Change Start, repository storage, and type-check commands during delivery.
The baseline quality gate passes 361 tests with one intentional skip, type checking, linting, formatting, and ast-grep, then remains nonzero on the five Task-149-approved Fallow boundary violations.
Task 150 must remove its owned Change Start violation and introduce no new quality failure.

## Implementation decision ledger

- Local: add Effect-native Task and Change Start persistence interfaces beside the synchronous compatibility interfaces, because Tasks 151 through 153 still require the compatibility path and Task 147 owns its removal.
- Local: keep domain rejection unions as successful Effect values and reserve `RepositoryStorageError` for the typed error channel, matching Task 146 and the Task 149 foundation.
- Local: compose scoped repository SQL and concrete persistence adapters at the repository edge, so Task and Change workflows receive only module-owned interfaces required by ADR 0014.
- Local: inject Change Start Git operations through one Change-owned interface whose production adapter wraps the existing native Git behavior, because Git provisioning belongs to Change and deterministic workflow tests need a system seam.
- Local: preserve current immediate transaction semantics for concurrent Task writes and Task-backed Change Start by acquiring SQLite's write reservation with an identity no-op at the start of the Effect SQL transaction, because the pinned adapter uses deferred `BEGIN` and existing public concurrency and atomicity behavior is normative.
- Local: keep the repository storage error contract module-neutral while SQLite owns its construction, so workflows and CLI result mapping do not depend on a storage adapter module.
- Local: map typed repository storage failures to the existing CLI storage results at the CLI boundary, preserving public output while unexpected defects remain defects.
- Local: keep Task Context draft filesystem operations synchronous around Effect-native Task persistence, because draft editing is local file behavior and this task owns only state storage migration.

## Primary verification seam

One CLI process creates and approves a Task, another starts and prepares its Change, and a later process reads the persisted Task state, Change, and Acceptance Context.

## Acceptance criteria

- [x] Task commands use Effect-native persistence without changing public output.
- [x] Change Start uses Effect-native persistence and injected Git operations.
- [x] Starting a Task-backed Change atomically creates the Change and transitions the Task.
- [x] Task comments and dependency replacement remain safe under concurrent CLI processes.
- [x] Task dependency errors are covered through their public CLI results.
- [x] Task approval and transition transactions use the Effect-native Task persistence contract.
- [x] Repository composition supplies the Change Start Git operations.

## Completion

- Implementation: `98e4e206b0298db47897d6347e172a112e91ca2b`.
- Review corrections: `59ab561`, `3f26f1c`, and `cfd8188`.
- Dependency graph update: `d5513bc`.
- Verification: 366 tests passed with one intentional skip; type checking, linting, formatting, ast-grep, docs, concurrency coverage, Change Start rollback coverage, and the cross-process primary seam passed.
- `nix develop -c just quality` remains nonzero only because the four pre-existing Task-149-approved Fallow boundary violations remain for Tasks 151 through 153.
- Spec review: `APPROVED WITH REQUIRED COMMENTS`; the required dependency-graph update is resolved.
- Standards review: `APPROVED WITH REQUIRED COMMENTS`; the required failure mapping and complexity corrections are resolved.

## Blocked by

- [Task 149](149-expand-effect-native-storage.md)
