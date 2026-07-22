# Cover Validation Workspace recovery

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

- [ ] A matching clean Validation Workspace is reused.
- [ ] A matching dirty Validation Workspace is removed and recreated.
- [ ] A Validation Workspace on another branch produces a Validation Tooling Failure.
- [ ] A Validation Workspace at another commit produces a Validation Tooling Failure.
- [ ] Failed removal produces a failure when the worktree remains.
- [ ] Failed removal permits recovery when later inspection proves that the worktree disappeared.
- [ ] Existing cleanup and temporary-ref behavior remains unchanged.
- [ ] The Validation Workspace recovery health finding is resolved without new quality findings.
- [ ] Focused lifecycle tests and the repository quality gate pass.

## Blocked by

None - can start immediately.
