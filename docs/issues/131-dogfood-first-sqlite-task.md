# Dogfood the first SQLite-tracked Change workflow

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/issues/123-ship-manual-task-workflow.md`

## Behaviors owned

- But Why? proves its complete Change-centered workflow on one approved repository change.
- Successful dogfooding moves active Task tracking from new Markdown drafts to SQLite.

## What to build

Use the installed v1 candidate to create and complete one approved Task-backed Change through the public CLI.

## Primary verification seam

One real Task and linked Change progressing from approved intent through an owned merged PR to durable completion.

## Acceptance criteria

- [ ] The follow-up Task is created, approved, and dependency-checked through `by`.
- [ ] `by change start --task` creates and prepares the owned branch and Managed Worktree.
- [ ] The Implementer uses the returned worktree directly or through Change Implement.
- [ ] Change Submit runs Acceptance Review and configured Specialists and returns actionable Findings when present.
- [ ] The Implementer fixes Findings and resubmits until one exact Candidate publishes.
- [ ] A human merges the PR and Change reconciliation records completion and cleanup state.
- [ ] Main and Managed Worktrees observe the same shared SQLite facts.
- [ ] Contributor and agent instructions declare SQLite Tasks as the source of truth for new active work.
- [ ] Existing Markdown issue files remain historical planning records rather than being deleted.
- [ ] Before Task 131 completes, create the npm publication Task in SQLite and link its historical specification.

## Blocked by

- `docs/issues/125-produce-installable-v1-package.md`
