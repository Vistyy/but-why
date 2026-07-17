# Remove incidental Git setup from SQLite tests

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`

## Behaviors owned

- Change and Candidate storage behavior is tested without unrelated Git repository setup.
- Real Git coverage remains where Git identity or history is observable behavior.

## What to build

Use a SQLite-only fixture for storage tests that do not inspect Git, while preserving the existing real-repository migration and Candidate-capture acceptance paths.

## Primary verification seam

Change and Candidate SQLite store tests using the shared schema fixture.

## Acceptance criteria

- [ ] Storage-only tests do not initialize a Git repository.
- [ ] Change and Candidate persistence constraints retain their current coverage.
- [ ] Schema migration tests that exercise `by init` retain real repository setup.
- [ ] Candidate capture and managed-worktree tests retain real Git coverage.
- [ ] The default suite remains green and its measured runtime does not regress.

## Blocked by

None - can start immediately.
