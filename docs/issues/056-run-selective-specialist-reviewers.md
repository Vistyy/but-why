# Run selective Specialist Reviewers

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Run configured Specialist Reviewers after checks and retain completion evidence across eligible linear Candidates.
Specialists that produce Findings remain unfinished until a later eligible run returns no Findings.

## Acceptance criteria

- [ ] All unfinished configured Specialists run in parallel after configured checks pass.
- [ ] Each Specialist records its concern, policy fingerprint, comparison base, Candidate, result, and Artifacts.
- [ ] A no-Findings result completes that Specialist for eligible later linear Candidates in the Change.
- [ ] A Specialist that produced Findings reruns after a successor Candidate.
- [ ] New Change, changed concern, changed policy, changed comparison base, or non-linear history resets completion evidence.
- [ ] Full validation runs when delta eligibility cannot be proved.

## Blocked by

- `docs/issues/055-add-shared-read-only-reviewer-runner.md`
