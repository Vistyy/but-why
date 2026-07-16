# Launch a Task Implementer in Herdr

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- Global user configuration may ask Task Start to open a visible Herdr child workspace and fresh Pi Implementer.
- Herdr remains presentation and process infrastructure rather than Task or Git authority.

## What to build

Extend Task Start with one optional Herdr integration that opens the existing But Why-owned worktree and launches the installed implementation workflow.
Do not build a generic session-provider framework.

## Primary verification seam

Task Start integration test against a fake Herdr CLI or socket adapter, followed by one local Herdr smoke test.

## Acceptance criteria

- [ ] Disabled integration leaves Task Start behavior unchanged and returns the managed worktree path.
- [ ] Enabled integration calls Herdr only after branch, worktree, Change, and Acceptance Context are durable.
- [ ] Herdr opens the existing worktree as a child workspace rather than creating Git state.
- [ ] A fresh Pi session starts in that worktree with the Task ID and installed implementation workflow.
- [ ] The coordinator remains focused while success returns Herdr workspace, tab, pane, and Pi session facts.
- [ ] Repeated Start never launches a duplicate active Implementer.
- [ ] Herdr or Pi launch failure preserves the valid Task worktree and returns a retryable launch result.
- [ ] Task inspection exposes the optional interactive session location and current observed status without treating it as Task truth.
- [ ] Cancellation stops the recorded interactive session before its terminal result commits.
- [ ] Herdr-specific documentation extends the installed core workflow with launch, inspection, intervention, and cancellation.

## Blocked by

- `docs/issues/083-start-task-in-managed-worktree.md`
- `docs/issues/117-cancel-task-and-owned-pr.md`
- `docs/issues/123-ship-manual-task-workflow.md`
