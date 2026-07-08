# Manage Validation Workspace lifecycle with Effect Scope

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Refactor Validation Workspace setup and cleanup to use Effect scoped resource management.

The caller-visible behavior from issue 011 should remain intact.

A Validation Workspace should be an Effect-scoped resource for the Validation Run workflow.
Future validation phases should run inside the Validation Workspace, not the user's checkout.
Issue 038 defines the workspace lifecycle but does not add validation phase execution.
Because validation phase execution does not exist yet, current v1 behavior should still clean up immediately after successful workspace setup.
Callers should not receive or invoke a manual cleanup function; the Effect Scope owns cleanup.
Reviewer agents and command producers should not receive the workspace path directly.
Only the Sandcastle or execution adapter layer should handle the workspace path as execution plumbing.
The workspace path should not be stored as durable Validation Run state.
Workspace paths may appear in tooling error details or logs when needed for diagnostics.

The implementation should replace manual partial-cleanup tracking with `Effect.acquireRelease`, `Scope`, or equivalent Effect scoped finalizers.
Lifecycle code should remain behind the Validation Workspace seam instead of spreading Effect scope logic into submit, check, or reviewer code.
Resource acquisition order should be fixed: create the temp validation ref first, then create the Sandcastle worktree.
If temp ref creation fails, no cleanup is needed because no cleanup-relevant resource was acquired.
If worktree creation fails after temp ref creation, temp ref cleanup should still run.

Cleanup should run when the Validation Run workflow no longer needs the workspace, when workspace setup fails partway through, when the workflow is interrupted, or when the workflow defects after acquiring a resource.
Cleanup is best effort for this issue: record cleanup failure details and stop rather than retrying indefinitely.
Cleanup should attempt every acquired resource even if one cleanup step fails, and record all cleanup failures.
Cleanup order should be fixed: remove the Sandcastle worktree first, then delete the temp validation ref.
On interruption, cleanup should still run and record cleanup details when possible, without blocking shutdown forever.

Sandcastle remains responsible for creating validation worktrees and running inside them.
Issue 038 should not redesign Sandcastle worktree creation or execution behavior.

## Out of scope

- Adding validation phase execution.
- Moving phase work into the Validation Workspace.

Later phase execution issues should explicitly require phase work to run inside the Validation Workspace, not the user's checkout.

## Acceptance criteria

- [x] Temp validation refs are acquired and released through an Effect scoped lifecycle.
- [x] Sandcastle validation worktrees are acquired and released through an Effect scoped lifecycle.
- [x] Lifecycle code remains behind the Validation Workspace seam.
- [x] Temp validation ref acquisition happens before Sandcastle worktree acquisition.
- [x] If temp ref creation fails, no cleanup runs.
- [x] If worktree creation fails after temp ref creation, temp ref cleanup still runs.
- [x] Future validation phases are expected to run inside the Validation Workspace.
- [x] Issue 038 does not add validation phase execution.
- [x] Until validation phase execution exists, successful workspace setup is followed by immediate scoped cleanup.
- [x] Callers do not receive or invoke a manual cleanup function.
- [x] Reviewer agents and command producers do not receive the workspace path directly.
- [x] Only the Sandcastle or execution adapter layer handles the workspace path.
- [x] Workspace paths are not stored as durable Validation Run state.
- [x] Workspace paths may appear in tooling error details or logs when needed for diagnostics.
- [x] Cleanup runs when the Validation Run workflow no longer needs the workspace.
- [x] Cleanup runs after setup failure once any cleanup-relevant resource has been acquired.
- [x] Cleanup runs when the Effect workflow is interrupted.
- [x] Interruption cleanup details are recorded when possible, without blocking shutdown forever.
- [x] Cleanup result details are recorded on Validation Tooling Failures.
- [x] Cleanup failure is a Validation Tooling Failure, not a Finding.
- [x] If setup fails and cleanup also fails, the setup failure remains the primary Validation Tooling Failure and cleanup failure is recorded as secondary detail.
- [x] Cleanup is best effort and does not retry indefinitely.
- [x] Cleanup attempts every acquired resource even if one cleanup step fails.
- [x] Cleanup removes the Sandcastle worktree before deleting the temp validation ref.
- [x] All cleanup failures are recorded.
- [x] Caller-visible validation workspace behavior from issue 011 remains unchanged.
- [x] Sandcastle factory usage remains behind the Validation Workspace seam.
- [x] Issue 038 does not redesign Sandcastle worktree creation or execution behavior.
- [x] Direct Effect runtime execution remains limited to `src/main.ts`.
- [x] Tests cover successful cleanup, partial setup cleanup, cleanup after failure, and cleanup after interruption.
- [x] Lifecycle edge case tests use fake adapters and do not require real Sandcastle or git for every case.

## Blocked by

- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
