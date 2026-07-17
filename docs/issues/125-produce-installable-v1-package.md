# Produce an installable v1 package

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/tooling.md`

## Behaviors owned

- One versioned package candidate contains the verified Change-centered CLI, skills, prompts, migrations, and public documentation needed by an external repository.

## What to build

Pack the dogfooded v1 and verify the complete installed surface from clean temporary repositories before registry publication.

## Primary verification seam

Tarball installation and Change-centered workflow smoke tests in clean repositories.

## Acceptance criteria

- [ ] The package contains only intended runtime, migration, prompt, skill, and public documentation files.
- [ ] Local and global installation expose the expected `by` executable and help.
- [ ] Init, Task intent commands, Task-backed and taskless Change Start, preparation, shared state, and inspection work from the installed package.
- [ ] Fake Pi and GitHub seams verify Task-backed, taskless, and no-change Submit through publication and reconciliation.
- [ ] Change cancellation and safe cleanup are represented in installed help and smoke coverage.
- [ ] Change Implement and the packaged `handoff-to-worktree` skill use the fake Herdr seam.
- [ ] Retired Task-centered implementation routes are absent.
- [ ] Optional Herdr integration fails clearly when unavailable and passes one local smoke test when enabled.
- [ ] Package version, provenance inputs, and release notes identify the exact source commit.
- [ ] The repository is green before the package candidate is accepted.

## Blocked by

- `docs/issues/123-ship-manual-task-workflow.md`
