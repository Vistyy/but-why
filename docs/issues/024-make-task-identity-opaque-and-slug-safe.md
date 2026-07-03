# Make Task identity opaque and slug-safe

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Make Task identity safe for both local Tasks and future remote authoritative Tasks without changing current local Task behavior.

Local Tasks should keep the existing local ID format.

Most callers should stop assuming that every Task ID has the local ID shape.

Code that creates branch names, temp refs, worktree paths, artifact paths, or other Git and filesystem names should use a safe derived slug instead of a raw Task ID.

This slice should preserve existing CLI behavior while preparing the codebase for future deterministic remote Task IDs.

## Acceptance criteria

- [ ] Existing local Task IDs keep working unchanged.
- [ ] Task IDs are treated as opaque identifiers outside the Task ID seam.
- [ ] Task ID parsing and validation are concentrated behind a Task-owned seam.
- [ ] Branch, temp ref, worktree, and path naming use safe derived slugs instead of raw Task IDs.
- [ ] Safe slugs are deterministic.
- [ ] Safe slugs can be derived from local Task IDs and future remote-style Task IDs.
- [ ] Existing submit and validation workspace behavior remains unchanged for local Tasks.
- [ ] Tests cover slug generation for local IDs and remote-style IDs.
- [ ] Tests cover that current local Task IDs remain accepted.
- [ ] No local alias mechanism for remote Tasks is introduced.

## Blocked by

- `docs/issues/023-replace-inline-task-state-unions-with-named-domain-type.md`
