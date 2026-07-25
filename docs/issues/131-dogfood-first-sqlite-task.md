# Dogfood the first SQLite-tracked Change workflow

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/issues/123-ship-manual-task-workflow.md`

## Behaviors owned

- But Why? proves its complete Change-centered workflow on one approved repository change.
- Successful dogfooding moves active Task tracking from new Markdown drafts to SQLite.

## What to build

Use the accepted v1 candidate through the repository command `just by` to create and complete one approved Task-backed Change.
Task 131 owns repo-local lifecycle dogfooding before publication.
Task 126 owns package execution from the npm registry through `pnpx`.

## Primary verification seam

One real Task and linked Change progressing from approved intent through an owned merged PR to durable completion.

## Acceptance criteria

- [x] The follow-up Task is created, approved, and dependency-checked through `just by`.
- [x] `just by change start --task` creates and prepares the owned branch and Managed Worktree.
- [x] The Implementer uses the returned worktree directly or through Change Implement.
- [x] Change Submit runs Acceptance Review and configured Specialists and returns actionable Findings when present.
- [x] The Implementer fixes Findings and resubmits until one exact Candidate publishes.
- [x] A human merges the PR and Change reconciliation records completion and cleanup state.
- [x] Main and Managed Worktrees observe the same shared SQLite facts.
- [x] Contributor and agent instructions declare SQLite Tasks as the source of truth for new active work.
- [x] Existing Markdown issue files remain historical planning records rather than being deleted.
- [x] Before Task 131 completes, create the npm publication Task in SQLite and link its historical specification.

## Completion

SQLite Task `BY-1` completed through merged owned pull request #2 and durable Change reconciliation.
The dogfood run returned an Acceptance Finding, accepted a corrected Candidate, and exposed follow-up work now tracked as SQLite Tasks.
SQLite Task `BY-14` owns npm publication and links `docs/issues/126-publish-but-why-to-npm.md` as its historical specification.
SQLite Task `BY-15` owns the blocked post-publication compatibility policy.

## Blocked by

- `docs/issues/125-produce-installable-v1-package.md`
