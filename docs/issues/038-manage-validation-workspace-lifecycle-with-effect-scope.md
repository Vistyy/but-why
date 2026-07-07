# Manage Validation Workspace lifecycle with Effect Scope

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Refactor Validation Workspace setup and cleanup to use Effect scoped resource management.

The current workspace behavior from issue 011 should remain intact.

The implementation should replace manual partial-cleanup tracking with `Effect.acquireRelease`, `Scope`, or equivalent Effect scoped finalizers.

Cleanup should run when workspace setup succeeds, fails partway through, is interrupted, or defects after acquiring a resource.

Sandcastle remains responsible for creating validation worktrees and running inside them.

## Acceptance criteria

- [ ] Temp validation refs are acquired and released through an Effect scoped lifecycle.
- [ ] Sandcastle validation worktrees are acquired and released through an Effect scoped lifecycle.
- [ ] Cleanup runs on success.
- [ ] Cleanup runs after setup failure once any cleanup-relevant resource has been acquired.
- [ ] Cleanup runs when the Effect workflow is interrupted.
- [ ] Cleanup result details are still recorded on Run tooling errors.
- [ ] Cleanup failures do not hide the original setup failure.
- [ ] Existing validation workspace behavior from issue 011 remains unchanged from the caller's point of view.
- [ ] Sandcastle factory usage remains behind the Validation Workspace seam.
- [ ] Direct Effect runtime execution remains limited to `src/main.ts`.
- [ ] Tests cover successful cleanup, partial setup cleanup, and cleanup after failure.

## Blocked by

- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
