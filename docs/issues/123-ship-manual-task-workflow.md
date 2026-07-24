# Ship the Change-centered manual workflow

## Specification

- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `docs/public/setup.md`
- `docs/public/config.md`

## Behaviors owned

- Installed users and implementation agents can follow the complete Change-centered v1 without repository-internal knowledge.
- Task commands explain intent while Change commands explain implementation and delivery.

## What to build

Update CLI help, public setup and configuration docs to teach Task-backed and taskless Change workflows from preparation through reconciliation and cancellation.

## Primary verification seam

Installed-package workflow test plus review of the public workflow documentation from an external repository.

## Acceptance criteria

- [x] The workflow teaches Task create, context, approval, and dependencies separately from Change Start, implementation, Submit, inspection, reconciliation, and cancellation.
- [x] Task-backed and taskless Change Start are documented with their different Acceptance Review behavior.
- [x] The workflow documents top-level Repository Preparation.
- [x] The workflow documents `by change prepare <change-id>` with successful and failed examples.
- [x] Direct manual Managed Worktree use is documented as the portable implementation path.
- [x] The workflow documents Change Implement as launching work in the recorded Managed Worktree.
- [x] Programmatic examples request JSON, while human examples retain default TOON output.
- [x] User-owned implementation guidance uses the Managed Worktree and repeated Change Submit instead of `/code-review`.
- [x] The workflow stops when the PR is ready for human merge and never merges it.
- [x] Deferred AFK, Fixer, Final Review, PR Writer, Supervisor, and PR-remediation capabilities are absent.
- [x] Every command template matches installed `--help` and structured output.

## Blocked by

- `docs/issues/107-remove-task-owned-validation.md`
- `docs/issues/117-cancel-task-and-owned-pr.md`
- `docs/issues/129-submit-task-with-no-change.md`
- `docs/issues/130-launch-task-implementer-in-herdr.md`

## Completion

Status: Complete.

Completion evidence: the installed-package workflow test covers taskless and Task-backed preparation, retry, inspection, Submission, Managed Worktree implementation, cancellation, and JSON output.

Completion evidence: `just full-quality` passed with 353 tests passed and 1 skipped.

Spec review: latched approved.

Standards review: latched approved.

Implementation commits: `a15bde3`, `bb99402`, `654e707`, and `600fae1`.
