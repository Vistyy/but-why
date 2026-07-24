# Produce the v1 package candidate

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/tooling.md`

## Behaviors owned

- One versioned package candidate contains the verified Change-centered CLI, prompts, migrations, and public documentation required for npm publication.

## What to build

Pack the dogfooded v1 and verify its contents before registry publication.
Task 126 owns public execution and workflow smoke tests through `pnpx`.

## Primary verification seam

Packed-file metadata and the repository quality commands.

## Acceptance criteria

- [ ] The package contains only intended runtime, migration, prompt, and public documentation files.
- [ ] The package metadata exposes the `by` executable through the built runtime entrypoint.
- [ ] The package does not expose `by task start` or top-level `by submit`.
- [ ] The package version, provenance metadata, and release notes identify the exact source commit.
- [ ] The repository is green before the package candidate is accepted.

## Blocked by

- `docs/issues/123-ship-manual-task-workflow.md`

## Completion

Status: Complete.

Completion evidence: `just quality` passed with 281 tests passed and 1 skipped.

Completion evidence: the packed candidate contains the built runtime, migrations, reviewer prompts, public documentation, and changelog, with stale generated output rejected by the installed-package boundary test.

Completion evidence: package metadata exposes `by` through `dist/main.js`, uses version `0.0.1`, and sets `private` to `false`.

Completion evidence: the `v0.0.1` tag points to the exact candidate commit `cc7a1790019cb4cc8c39087cba806b8a50724f70`.

Implementation commits: `1e5ea12` and `cc7a179`.
