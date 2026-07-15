# Complete an approved Task with no change

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0012-control-task-progress-through-lifecycle-operations.md`
- `docs/adr/0013-require-a-pr-or-verified-no-change-completion.md`

## Behaviors owned

- Every changed Task completes through a merged owned PR.
- `by task complete` is the narrow terminal path for an approved Task whose intent required no repository change.
- No-change completion requires a reason and proves a clean zero-diff result under a write fence.

## What to build

Implement race-safe no-change completion across Task, Change, managed workspace, Candidate, PR, dependency, activity, and CLI boundaries.
The command must reject rather than erase or bypass changed work.

## Primary verification seam

Task no-change completion test in a temporary repository with a controlled active worker.

## Acceptance criteria

- [ ] `by task complete <id> --reason <reason>` is available only after permanent Task Approval and before terminal closure.
- [ ] Missing or empty reason is a usage error before mutation.
- [ ] The operation first fences the Task and stops active owned work.
- [ ] An approved Task that never started completes without manufacturing a Change or workspace.
- [ ] A started Task proves that no owned PR exists.
- [ ] A started Task proves its managed branch has no net tree diff from the Change's recorded base.
- [ ] A started Task proves every managed workspace has no staged, unstaged, untracked, or dirty submodule work.
- [ ] Ignored files do not count as repository changes.
- [ ] Concurrent Candidate, workspace, or PR creation makes completion reject without partial closure.
- [ ] Any changed work rejects with legal guidance to Submit or Cancel.
- [ ] Success records the reason, closes an open Change as completed, moves the Task to Done, removes it from Task Queue Order, and satisfies dependents.
- [ ] Repeated completion returns the original result as a successful no-op.
- [ ] The Done Task is read-only and its completion proof remains inspectable.

## Open decisions to grill

- Exact recursive submodule inspection and unavailable-submodule behavior.
- Exact reason input, completion proof, and concurrent-conflict AXI schemas.

## Blocked by

- `docs/issues/079-manage-task-dependency-graph.md`
- `docs/issues/083-start-eligible-task-backed-change-manually.md`
- `docs/issues/101-reconcile-one-owned-pr-once.md`
- `docs/issues/118-stop-active-local-work-after-cancellation.md`
