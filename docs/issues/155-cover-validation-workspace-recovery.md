# Cover Validation Workspace recovery

## Status

Done.

## Specification

- [Create Validation Workspaces through Sandcastle](011-create-validation-workspaces-through-sandcastle.md)
- [Manage the Validation Workspace lifecycle with Effect Scope](038-manage-validation-workspace-lifecycle-with-effect-scope.md)
- [Validation execution and history migration](152-migrate-validation-execution-and-history.md)
- [Taskless Changes and worktree handoff](../specs/taskless-changes-and-worktree-handoff.md)

## Behaviors owned

- Validation Workspace creation reuses an existing worktree only when the worktree belongs to the same Validation Run and Candidate commit.
- Validation Workspace creation replaces a matching dirty worktree only when removal succeeds or later inspection proves that the worktree disappeared.
- Validation Workspace creation reports a Validation Tooling Failure when an existing worktree belongs to another branch or commit.
- Validation Workspace creation preserves cleanup and temporary-ref behavior during recovery.

## What to build

Cover every existing-worktree recovery decision through the Validation Workspace lifecycle seam.

Preserve the current safety rules and Tooling Failure results.
Simplify the recovery decision only if public coverage does not remove the health finding.

## Primary verification seam

Validation Workspace lifecycle tests demonstrate reuse, safe replacement, and rejection for existing worktrees.

## Acceptance criteria

- [x] A matching clean Validation Workspace is reused.
- [x] A matching dirty Validation Workspace is removed and recreated.
- [x] A Validation Workspace on another branch produces a Validation Tooling Failure.
- [x] A Validation Workspace at another commit produces a Validation Tooling Failure.
- [x] Failed removal produces a failure when the worktree remains.
- [x] Failed removal permits recovery when later inspection proves that the worktree disappeared.
- [x] Existing cleanup and temporary-ref behavior remains unchanged.
- [x] The Validation Workspace recovery health finding is resolved without new quality findings.
- [x] Focused lifecycle tests and the repository quality gate pass.

## Scoped implementation record

- Baseline: `c0613e1f2fbb9d7aea216beff08856f710ab468f`.
- Spec review source: this task draft.
- Normative traceability: Tasks 011, 038, and 152, plus `docs/specs/taskless-changes-and-worktree-handoff.md` and ADRs 0001 and 0002.
- Primary seam: `test/validation-workspace-lifecycle.test.ts` through `createValidationWorkspace`.

| Acceptance criterion | Implementation target | Public test seam | Verification target |
| --- | --- | --- | --- |
| Matching clean workspaces are reused | Existing-worktree preparation | Validation Workspace lifecycle test | No recovery removal before workspace acquisition |
| Matching dirty workspaces are safely replaced | Existing-worktree preparation and removal adapter | Validation Workspace lifecycle test | Removal precedes recreation |
| Other branches and commits are rejected | Existing-worktree preparation | Validation Workspace lifecycle tests | Validation Tooling Failure result and temp-ref cleanup |
| Failed removal is safe | Existing-worktree preparation | Validation Workspace lifecycle tests | Remaining worktree fails; disappeared worktree recovers |
| Cleanup and temporary-ref behavior remains unchanged | Scoped resource lifecycle | Existing lifecycle tests and recovery tests | Cleanup order and results remain unchanged |
| Recovery health finding is resolved | Lifecycle coverage | Full coverage report and Fallow health check | `prepareExistingWorktree` is no longer above the CRAP threshold |
| Validation and quality checks pass | Repository quality recipes | Focused lifecycle test and quality gate | `just test test/validation-workspace-lifecycle.test.ts`, `just typecheck`, and `just quality` |

Required validation commands are `just test test/validation-workspace-lifecycle.test.ts`, `just typecheck`, `just format-check`, `just lint`, and `just quality`.
The full quality gate is expected to retain the user-approved Task 157 `handoffFileError` health finding until Task 157 is completed.

## Implementation decision ledger

- User-approved: leave the independent Task 157 `handoffFileError` health finding to Task 157 while completing Task 155.
- Local: add lifecycle coverage through the existing fake-adapter seam without changing production recovery behavior because the current implementation already satisfies the approved safety rules.
- Deferred to Task 156: final clean-checkout quality-gate verification after the remaining pre-gate tasks are complete.

## Completion

- Implementation: `5dbda408708ca1726e4c42278c9c59bc162db24a`.
- Verification: 373 tests passed with one intentional skip; focused Validation Workspace lifecycle tests passed with 12 tests; type checking, formatting, linting, and documentation checks passed.
- Verification: `just quality` remains nonzero only for the user-approved Task 157 `handoffFileError` health finding.
- Spec review: `APPROVED`.
- Standards review: `APPROVED`.

## Blocked by

None - can start immediately.
