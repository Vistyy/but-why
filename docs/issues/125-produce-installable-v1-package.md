# Produce an installable v1 package

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/tooling.md`

## Behaviors owned

- One versioned package candidate contains the verified public CLI, skill, prompts, migrations, and documentation needed by an external repository.

## What to build

Pack the dogfooded v1 and verify the complete installed surface from clean temporary repositories before registry publication.

## Primary verification seam

Tarball installation and manual-workflow smoke suite in clean repositories.

## Acceptance criteria

- [ ] The package contains only intended runtime, migration, prompt, skill, and public documentation files.
- [ ] Local and global installation expose the expected `by` executable and help.
- [ ] Init, Task creation, Approval, dependencies, Start, shared linked-worktree state, and inspection work from the installed package.
- [ ] Fake Pi and GitHub seams verify changed and no-change Submit through publication and reconciliation.
- [ ] Optional Herdr integration fails clearly when unavailable and passes one local smoke test when enabled.
- [ ] Package version, provenance inputs, and release notes identify the exact source commit.
- [ ] The repository is green before the package candidate is accepted.

## Blocked by

- `docs/issues/130-launch-task-implementer-in-herdr.md`
