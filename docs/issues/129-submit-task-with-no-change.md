# Submit a Task with no repository change

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0013-require-a-pr-or-verified-no-change-completion.md`

## Behaviors owned

- Submit detects when the current tracked tree equals the Task's recorded starting tree.
- Acceptance Review alone determines whether the existing repository already satisfies the Task.

## What to build

Add the no-change branch to `by submit <task-id>` without another command, flag, reason, Checks, Specialists, or PR.

## Primary verification seam

No-change Submit test with passing and blocking fake Acceptance reports.

## Acceptance criteria

- [ ] No-change detection compares tracked trees and requires clean staged and non-ignored untracked state.
- [ ] A real Candidate record references the existing starting commit without fabricating a commit.
- [ ] One Candidate-owned Acceptance-only Validation Run stores the no-change judgment and Findings.
- [ ] Only Acceptance Review runs and receives no Implementer explanation.
- [ ] Passing Acceptance marks the Task Done with completion kind `no_change`.
- [ ] Acceptance Findings return the Task to implementing.
- [ ] Prepare, Checks, Specialists, and publication do not run.
- [ ] Repeated successful no-change Submit returns the durable completion unchanged.

## Blocked by

- `docs/issues/096-run-built-in-acceptance-review.md`
- `docs/issues/105-migrate-task-submit.md`
