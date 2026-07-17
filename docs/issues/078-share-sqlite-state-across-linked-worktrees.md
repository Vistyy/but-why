# Share SQLite state across linked worktrees

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- Every linked worktree of one repository uses the same But Why? operational state and Artifact storage.
- Tracked Repo Config remains available through normal Git checkout behavior.

## What to build

Resolve SQLite, Artifacts, and shared local operational storage through `<git-common-dir>/but-why/` instead of the current worktree root.
Create shared state directly for new installations.
A one-time relocation of this checkout's existing local state is outside the product.
Keep tracked Repo Config at `<worktree-root>/.but-why/config.json`.
Store the canonical Git common directory as the SQLite shared-state identity and reject a mismatch.
Store Artifact paths relative to the shared Artifact root.

## Primary verification seam

Linked-worktree CLI test that creates a Task in one worktree and reads it from another.

## Acceptance criteria

- [x] The main checkout and linked worktrees resolve one SQLite database and Artifact root.
- [x] New installations create shared state at `<git-common-dir>/but-why/` without a runtime migration path.
- [x] Repo Config remains at `<worktree-root>/.but-why/config.json`.
- [x] Commands reject repositories whose shared state identity conflicts with the current Git common directory.
- [x] An Artifact with a shared-Artifact-root-relative path written from one worktree is inspectable from every linked worktree.
- [x] Concurrent commands from separate worktrees retain current SQLite serialization guarantees.
- [x] Setup and internal documentation describe the supported shared-state path.

## Completion

Implemented by `096dad12d7fdccf5c60f87bd1cf6d1020241575f` and corrected by the follow-up commit.

## Blocked by

None - can start immediately.
