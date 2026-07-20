# Submit a Task-backed Change with no repository change

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/specs/taskless-changes-and-worktree-handoff.md`
- `CONTEXT.md`
- `docs/adr/0013-require-a-pr-or-verified-no-change-completion.md`

## Behaviors owned

- Change Submit detects when a Task-backed Change's tracked tree equals its recorded starting tree.
- Acceptance Review alone determines whether the existing repository already satisfies the Task.

## What to build

Add the Task-backed no-change branch to `by change submit <change-id>` without another command, flag, reason, Checks, Specialists, or PR.

## Primary verification seam

No-change Change Submit test with passing and blocking fake Acceptance reports.

## Acceptance criteria

- [ ] No-change detection compares the tracked tree with the Change's starting commit.
- [ ] No-change completion requires no staged changes or non-ignored untracked files.
- [ ] A real Candidate record references the existing starting commit without fabricating a commit.
- [ ] One Candidate-owned Acceptance-only Validation Run stores the no-change judgment and Findings.
- [ ] Exactly one Acceptance Review runs against the existing starting commit.
- [ ] Acceptance Review receives no Implementer explanation.
- [ ] Passing Acceptance marks the linked Task Done with completion kind `no_change`.
- [ ] Acceptance Findings return the Task to implementing.
- [ ] Prepare, Checks, Specialists, and publication do not run.
- [ ] Taskless unchanged Changes remain owned by issue 105 and return `nothing_to_submit` instead.
- [ ] Repeated successful no-change Submit returns the durable completion unchanged.

## Blocked by

- `docs/issues/096-run-built-in-acceptance-review.md`
- `docs/issues/105-migrate-task-submit.md`
