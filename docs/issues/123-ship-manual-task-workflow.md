# Ship the Change-centered manual workflow

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/public/setup.md`
- `docs/public/config.md`

## Behaviors owned

- Installed users and implementation agents can follow the complete Change-centered v1 without repository-internal knowledge.
- Task commands explain intent while Change commands explain implementation and delivery.

## What to build

Update CLI help, public setup and configuration docs, and the installed But Why skills to teach Task-backed and taskless Change workflows from preparation through reconciliation and cancellation.

## Primary verification seam

Installed-package workflow test plus review of the packaged skills from an external repository.

## Acceptance criteria

- [ ] The workflow teaches Task create, context, approval, and dependencies separately from Change Start, implementation, Submit, inspection, reconciliation, and cancellation.
- [ ] Task-backed and taskless Change Start are documented with their different Acceptance Review behavior.
- [ ] Top-level Repository Preparation and explicit preparation retry are documented with valid examples.
- [ ] Direct manual Managed Worktree use is documented as the portable implementation path.
- [ ] Change Implement and the user-only `handoff-to-worktree` skill are documented without session-copying claims.
- [ ] Programmatic examples request JSON, while human examples retain default TOON output.
- [ ] The implementation skill uses the Managed Worktree and repeated Change Submit instead of `/code-review`.
- [ ] The workflow stops when the PR is ready for human merge and never merges it.
- [ ] Deferred AFK, Fixer, Final Review, PR Writer, Supervisor, and PR-remediation capabilities are absent.
- [ ] Every command template matches installed `--help` and structured output.

## Blocked by

- `docs/issues/107-remove-task-owned-validation.md`
- `docs/issues/117-cancel-task-and-owned-pr.md`
- `docs/issues/129-submit-task-with-no-change.md`
- `docs/issues/130-launch-task-implementer-in-herdr.md`
