# Complete Final Review

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Final Review is the last Validation Gate phase.
- It judges the whole exact Candidate after checks, applicable Acceptance Review, and every unfinished Specialist pass.
- Final Findings form one Final Fixer batch, and every successor Candidate restarts from Prepare.

## What to build

Add the always-on Pi Final Reviewer and its revision loop to standalone validation.
Complete a Run as passed only when the exact Candidate has clean checks, eligible Specialist completion, and clean Final Review.

## Primary verification seam

Final Reviewer `by validate` test.

## Acceptance criteria

- [ ] Final Review starts only after checks, applicable Acceptance Review, and every Specialist are complete.
- [ ] One fresh Final Reviewer session judges the whole exact Candidate.
- [ ] Final Findings complete that Candidate's Run as blocked and form one phase-local Fixer batch.
- [ ] A Fixer successor Candidate starts a new Run from Prepare.
- [ ] Eligible completed Specialist evidence remains reusable after a Final fix.
- [ ] Final Review reruns fresh on every successor Candidate.
- [ ] The Final Fixer makes and records its decisions and attempts the complete batch without requesting Needs Input.
- [ ] If code verifies that the execution produced no clean successor Candidate, orchestration preserves the open Findings and records Needs Input after approved recovery is exhausted.
- [ ] Clean Final Review completes the full available Run as passed atomically.
- [ ] Reviewer output exhaustion is a Tooling Failure on the Attempt rather than a Finding.

## Open decisions to grill

- Built-in Final prompt and Repo Config override contract.
- Final Reviewer profile selection and output limits.
- Exact phase activity and AXI inspection schema.

## Blocked by

- `docs/issues/093-coordinate-specialist-fixing-batches.md`
