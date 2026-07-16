# Migrate Task inspection to Change-owned facts

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Task list and show project current progress from Task, Change, Candidate, Validation Run, and owned PR facts.

## What to build

Replace Task-owned validation readers with the new ownership model while preserving concise default output and detailed inspection links.

## Primary verification seam

Task list and show CLI tests across unstarted, blocked, validating, ready, done, and cancelled Tasks.

## Acceptance criteria

- [ ] Task show exposes approval, direct dependencies, Change, managed worktree, starting commit, current Candidate, latest Findings, and PR state.
- [ ] Task list exposes state, start eligibility, direct blockers, and the next legal action.
- [ ] Validation detail links resolve through Candidate-owned Run inspection.
- [ ] No Task inspection path reads legacy Task-owned validation or delivery tables.
- [ ] Empty and unavailable states are explicit in structured output.
- [ ] Output remains bounded with complete detail commands.

## Blocked by

- `docs/issues/087-inspect-candidate-owned-validation-run.md`
- `docs/issues/101-reconcile-owned-pr-during-submit.md`
- `docs/issues/105-migrate-task-submit.md`
