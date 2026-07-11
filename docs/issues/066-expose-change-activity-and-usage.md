# Expose Change activity and usage summaries

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Expose durable Change activity, Validation Run and Code-Writing Execution detail, failures, Findings, decisions, Artifacts, and token usage through structured CLI views.
Task views aggregate linked Change facts without owning them.

## Acceptance criteria

- [ ] A Change view shows its Candidates, current eligibility, Needs Input, PR identity, and lifecycle facts.
- [ ] Validation Run views show policy, checks, reviewers, Findings, completion evidence, failures, and Artifacts.
- [ ] Code-Writing Execution views show role, inputs, status, result, decisions, failures, Artifacts, and usage.
- [ ] Usage summaries group tokens by Change, Candidate, Validation Run, execution role, reviewer, and agent profile where applicable.
- [ ] Task views link to and summarize the active Change without copying its records.
- [ ] Human and structured outputs distinguish unknown usage from zero usage.

## Blocked by

- `docs/issues/056-run-selective-specialist-reviewers.md`
- `docs/issues/057-record-code-writing-executions-and-fix-check-findings.md`
- `docs/issues/060-add-change-owned-needs-input-and-resume.md`
- `docs/issues/061-publish-exact-validated-head-with-submit.md`
- `docs/issues/062-reconcile-pr-facts-and-later-heads.md`
