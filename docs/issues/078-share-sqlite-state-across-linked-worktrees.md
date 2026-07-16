# Share SQLite state across linked worktrees

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- Every linked worktree of one repository uses the same But Why? operational state and Artifact storage.
- Tracked Repo Config remains available through normal Git checkout behavior.

## What to build

Resolve SQLite, Artifacts, and shared local operational storage through Git's common directory instead of the current worktree root.
Migrate the existing local state safely without copying or symlinking databases between worktrees.

## Primary verification seam

Linked-worktree CLI test that creates a Task in one worktree and reads it from another.

## Acceptance criteria

- [ ] The main checkout and linked worktrees resolve one SQLite database and Artifact root.
- [ ] Existing initialized state migrates idempotently to the shared location.
- [ ] Repo Config remains at `.but-why/config.json`.
- [ ] Commands reject repositories whose shared state identity conflicts with the current Git common directory.
- [ ] An Artifact written from one worktree is inspectable from every linked worktree.
- [ ] Concurrent commands from separate worktrees retain current SQLite serialization guarantees.
- [ ] Setup and internal documentation describe the supported shared-state path.

## Blocked by

None - can start immediately.
