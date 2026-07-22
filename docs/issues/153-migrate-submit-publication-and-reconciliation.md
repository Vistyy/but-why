# Migrate Submit, publication, and reconciliation

## Status

Done.

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

## Scoped implementation record

- Baseline: `ed206384fc20a5f0ab410444e1cf57221b7c9289`.
- Spec review source: this task draft.
- Normative traceability: Task 146, the Taskless Changes and worktree handoff specification, ADR 0014, `docs/architecture.md`, and the Effect-first storage spike.
- Primary seam: a cross-process Change CLI workflow captures a Candidate, submits it, records publication, observes merge state, reconciles the Change, and reads the completed Task and cleanup result.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Submit, publication, and reconciliation use Effect-native persistence | Change Submit, Candidate publication, reconciliation, and their Change-owned SQLite operations | Change Submit, Candidate publication, and reconciliation integration | Production delivery lifecycle composes `RepositorySql` Effects without synchronously executing store operations |
| Task-backed and taskless behavior remains unchanged | Change Submit orchestration and CLI result mapping | Cross-process Change Submit integration | Both Change forms preserve validation, publication, Finding, Task lifecycle, and nothing-to-submit results |
| Publication protections remain unchanged | Candidate publication persistence and GitHub gateway coordination | Candidate publication integration | Retry, reservation release, ownership, and expected-head behavior remain stable |
| Reconciliation records completion atomically | Change-owned completion and cleanup persistence | Cross-process reconciliation integration | Merged Change, linked Task, owned PR facts, and each cleanup result are transactionally durable |
| GitHub target behavior has explicit coverage | GitHub PR target adapter | GitHub target adapter tests | HTTPS, scp-style SSH, `ssh://`, `.git`, unsupported and malformed remotes, missing defaults, and tooling failures have stable results |
| Change CLI output and error behavior remain covered | Change CLI Submit and Reconcile routes | Change CLI integration and command tests | JSON and TOON results plus storage, target, reconciliation, publication, validation, readiness, and closed-Change errors remain stable |
| Repository composition supplies external operations | Local Change composition | Change Submit and reconciliation CLI integration | Workflows receive GitHub target and cleanup operations through narrow injected interfaces |
| Every production storage caller uses Effect-native contracts | Remaining Change delivery callers | Repository quality gate and delivery lifecycle integration | No production Change delivery caller synchronously invokes a store operation |

Required verification is `nix develop -c just quality` plus focused Change Submit, publication, reconciliation, CLI, type-check, lint, formatting, ast-grep, docs, build, and Fallow commands.
The baseline has 371 passing tests, one intentional skip, and only the two Task-153 Fallow boundary violations recorded by Task 152.

## Implementation decision ledger

- Local: preserve domain rejection unions as successful Effect values and propagate repository storage failures through typed Effect error channels.
- Local: keep GitHub target detection and cleanup as narrow injected operations composed at the repository edge.
- Local: use Change-owned `RepositorySql.transactionImmediate` operations for merged completion and cleanup-result persistence.
- Local: cover remote URL parsing at the GitHub target adapter seam and preserve the current supported forms and diagnostics.
- User-approved: resolve the reconciliation workflow and Change Reconcile CLI health findings in Task 153.
- User-approved, deferred to Task 147: remove the temporary synchronous storage implementation and its three health findings after this task migrates every production caller.
- User-approved, deferred to Task 154: cover Task Dependency CLI error mappings and resolve their two health findings.
- User-approved, deferred to Task 155: cover Validation Workspace recovery and resolve its health finding.
- User-approved, deferred to Task 157: cover Change Implement handoff errors and resolve its health finding.
- Deferred to Task 135: consolidate surviving source hierarchy and names.

## Primary verification seam

A cross-process CLI workflow captures a Candidate, submits it, records publication, observes merge state, reconciles the Change, and reads the completed Task and cleanup result.

## Acceptance criteria

- [x] Submit, publication, and reconciliation use Effect-native persistence.
- [x] Task-backed and taskless Change behavior remains unchanged.
- [x] Publication retry, release, ownership, and expected-head protections remain unchanged.
- [x] Reconciliation atomically records merged Change, linked Task, pull-request, and cleanup state.
- [x] Supported GitHub remote forms and malformed targets have explicit behavior coverage.
- [x] Change CLI output and operational error branches are covered.
- [x] Repository composition supplies GitHub target and cleanup operations to Change workflows.
- [x] Every production storage caller uses the Effect-native contract required before Task 147.

## Completion

- Implementation: `636d868ef1cf80e79d526a6442eb9c862531a553`.
- Verification: 387 tests passed with one intentional skip.
- Type checking, linting, formatting, ast-grep, documentation, build, focused delivery lifecycle checks, and Fallow architecture checks passed.
- The user approved the seven remaining baseline Fallow health findings for Tasks 147, 154, 155, and 157.
- Completion update: this administrative commit.
- Spec review: `APPROVED`.
- Standards review: `APPROVED`.

## Blocked by

- [Task 152](152-migrate-validation-execution-and-history.md)
