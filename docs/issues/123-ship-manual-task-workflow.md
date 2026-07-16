# Ship the manual Task workflow

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `docs/public/setup.md`
- `docs/public/config.md`

## Behaviors owned

- Installed users and implementation agents can follow the complete reduced v1 without repository-internal knowledge.

## What to build

Update CLI help, public setup and configuration docs, and the installed But Why skill to teach Task approval, dependencies, managed worktrees, Submit, Findings, no-change completion, PR reconciliation, and cancellation.

## Primary verification seam

Installed-package workflow test plus review of the packaged skill from an external repository.

## Acceptance criteria

- [ ] The workflow teaches create, approve, dependency setup, Start, implementation, Submit, Findings, human merge, repeated Submit, and Cancel.
- [ ] The implementation skill uses the managed Task worktree and replaces `/code-review` with repeated `by submit` validation.
- [ ] The skill stops when the PR is ready for human merge and never merges it.
- [ ] Direct manual worktree use is documented as the portable implementation path.
- [ ] Global Acceptance and Specialist configuration precedence is documented with valid examples.
- [ ] Simple copied local validation files are documented without identity or reproducibility claims.
- [ ] Deferred AFK, Fixer, Needs Input, Hold, Supervisor, and PR-remediation commands are absent.
- [ ] Every command template matches installed `--help` and structured output.

## Blocked by

- `docs/issues/107-remove-task-owned-validation.md`
- `docs/issues/117-cancel-task-and-owned-pr.md`
- `docs/issues/129-submit-task-with-no-change.md`
