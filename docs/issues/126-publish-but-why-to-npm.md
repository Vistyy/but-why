# Publish But Why? to npm

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/issues/125-produce-installable-v1-package.md`

## Behaviors owned

- The verified unscoped `but-why` package is publicly executable through `pnpx` with provenance.

## What to build

Publish the exact verified package candidate through npm trusted publishing and confirm execution from the public registry.

## Primary verification seam

Clean-repository execution through `pnpx` followed by the Change-centered CLI smoke suite.

## Acceptance criteria

- [ ] Trusted publishing publishes the exact tarball verified by Task 125 without a long-lived npm token.
- [ ] npm provenance identifies the release source and workflow.
- [ ] The public package name, version, executable, files, and metadata match the verified candidate.
- [ ] `pnpx` can run help, init, and the documented Change-centered setup path from a clean repository.
- [ ] Release notes describe Task-backed and taskless Changes without presenting deferred capabilities as v1.
- [ ] If publication fails, recovery does not publish a different artifact under the same version.

## Blocked by

- `docs/issues/131-dogfood-first-sqlite-task.md`
