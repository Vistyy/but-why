# Dogfood the first SQLite-tracked Task

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/issues/123-ship-manual-task-workflow.md`

## Behaviors owned

- But Why? proves its complete manual workflow on its own next real work item.
- Successful dogfooding moves active Task tracking from new Markdown drafts to SQLite.

## What to build

Use the installed v1 candidate to create and complete one real follow-up Task through the public CLI.
The follow-up must be useful product work rather than a synthetic fixture.

## Primary verification seam

One real Task record progressing from New through an owned merged PR to Done in But Why's SQLite state.

## Acceptance criteria

- [ ] The follow-up Task is created, approved, dependency-checked, and started through `by`.
- [ ] Start creates the owned branch and managed worktree.
- [ ] The Task uses the returned worktree directly and may use Herdr when the optional integration is already available.
- [ ] Submit runs Acceptance and configured Specialists and returns actionable Findings when present.
- [ ] The Implementer fixes Findings and resubmits until one exact Candidate publishes.
- [ ] A human merges the PR and repeated Submit records Done.
- [ ] Main and Task worktrees observe the same shared SQLite facts.
- [ ] Contributor and agent instructions declare SQLite Tasks as the source of truth for new active work.
- [ ] Existing Markdown issue files remain historical planning records rather than being deleted.
- [ ] The remaining npm publication work is created as a SQLite Task linked to its historical specification before Task 131 completes.

## Blocked by

- `docs/issues/125-produce-installable-v1-package.md`
