# Close the Specialist fixing loop

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Feed Specialist Findings into Fixer Executions, create successor Candidates, and continue selective Specialist validation until every configured concern is complete.

## Acceptance criteria

- [ ] Open Specialist Findings can be assigned together to one Fixer Execution when their instructions are compatible.
- [ ] The Fixer receives exact Findings and durable Change context without reviewer-private state.
- [ ] Every successful fix creates a successor Candidate and reruns all configured checks.
- [ ] Specialists that produced Findings rerun, while eligible completed Specialists remain complete.
- [ ] Finding resolution links identify the successor Candidate and validating reviewer result.
- [ ] The loop stops safely when the execution budget or recovery limit is exhausted.

## Blocked by

- `docs/issues/056-run-selective-specialist-reviewers.md`
- `docs/issues/057-record-code-writing-executions-and-fix-check-findings.md`
