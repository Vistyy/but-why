# Make Task identity opaque and slug-safe

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Make Task identity safe for both local Tasks and future remote authoritative Tasks without changing current local user-facing Task behavior.

Local Tasks should keep the existing local ID format.

Most callers should stop assuming that every Task ID has the local ID shape.

Code that creates branch names, temp refs, worktree paths, artifact paths, or other Git and filesystem names should use a canonical safe derived Task Slug instead of a raw Task ID.

All Task Slugs should use one algorithm for local and remote-style Task IDs: a normalized readable part plus a hash suffix.
Task Slug generation hashes the exact raw Task ID string after Task ID validation, not the normalized readable part.
Task Slug generation should permit raw Task IDs to contain path separators because path and ref safety belong to the slug, not the Task ID.
Task Slug generation should bound the readable part while always preserving the hash suffix.
Git and filesystem-facing run names should stop embedding raw Task IDs and should use Task Slug plus run number instead.

This slice should preserve existing CLI and user-facing local Task behavior while preparing the codebase for future deterministic remote Task IDs.
Internal Git and filesystem names may change to slug-derived names for local Tasks.
CLI parsing should accept any valid opaque Task ID string, but local-only task resolution should reject remote-backed Task IDs with `remote_tasks_not_supported` until remote Task Authorities are implemented or configured.

## Acceptance criteria

- [ ] Existing local Task IDs keep working unchanged.
- [ ] Task IDs are treated as opaque identifiers outside the Task ID seam.
- [ ] Task ID parsing and validation are concentrated behind a Task-owned seam.
- [ ] Raw Task ID validation is minimal and bounded: non-empty after trim, no surrounding whitespace, no control characters, and a maximum length.
- [ ] Local Task ID shape validation is local-authority-specific and does not leak into general Task ID parsing.
- [ ] Branch, temp ref, worktree, and path naming use safe derived slugs instead of raw Task IDs.
- [ ] Safe slugs are deterministic.
- [ ] Safe slugs use one algorithm for local and remote-style Task IDs.
- [ ] Safe slugs include a hash suffix for all Task IDs, including local Task IDs.
- [ ] Safe slugs hash the exact raw Task ID string after validation.
- [ ] Safe slug readable parts are length-bounded while preserving the hash suffix.
- [ ] Git and filesystem-facing run names use Task Slug plus run number instead of raw Task ID.
- [ ] Safe slugs can be derived from local Task IDs and future remote-style Task IDs.
- [ ] Existing submit and user-facing local Task behavior remains unchanged for local Tasks.
- [ ] CLI Task ID parsing accepts valid opaque Task ID strings without requiring local ID shape.
- [ ] Local-only task resolution returns `remote_tasks_not_supported` for valid non-local Task IDs while remote Task Authorities are not supported.
- [ ] Local task resolution still returns `task_not_found` for supported local Task IDs that do not exist.
- [ ] Internal Git and filesystem names may use slug-derived names for local Tasks.
- [ ] Tests cover slug generation for local IDs and remote-style IDs.
- [ ] Tests cover that current local Task IDs remain accepted.
- [ ] No local alias mechanism for remote Tasks is introduced.

## Blocked by

- `docs/issues/023-replace-inline-task-state-unions-with-named-domain-type.md`
