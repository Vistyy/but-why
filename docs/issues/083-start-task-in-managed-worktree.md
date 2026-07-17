# Start a Task in a managed worktree

## Status

Done.

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0004-use-canonical-task-slugs-for-operational-names.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Task Start creates one owned Change, branch, and persistent worktree from the local default branch.
- Start captures immutable Acceptance Context and launches no validation.

## What to build

Expand `by task start <task-id>` into the durable manual implementation boundary and return the managed worktree path as the caller's next working directory.

## Primary verification seam

Temporary Git repository test covering Task Start from the main checkout and linked-worktree reuse.

## Acceptance criteria

- [x] Start requires an approved, dependency-unblocked Todo Task.
- [x] Start resolves the local default branch and records its exact starting commit.
- [x] Start creates a canonical But Why-owned Task branch and persistent Git worktree.
- [x] Start atomically binds the Task, Change, branch intent, starting commit, and Acceptance Context before recoverable worktree provisioning.
- [x] Repeated Start creates no second Change, branch, worktree, or Acceptance Context.
- [x] A missing recorded worktree is recreated only after branch and repository ownership are verified.
- [x] An unexpected branch or worktree conflict is preserved and returned as an actionable error.
- [x] Success output includes Task, Change, branch, starting commit, worktree path, and next Submit command.

## Completion

Implemented in `3b465b8`.
Review corrections are pending.
Quality passed with 286 tests.

## Blocked by

- `docs/issues/077-approve-task-intent.md`
- `docs/issues/079-manage-task-dependency-graph.md`
