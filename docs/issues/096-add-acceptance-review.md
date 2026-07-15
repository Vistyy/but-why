# Insert Acceptance Review before Specialists

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Acceptance Review runs after checks and before Specialists when immutable Acceptance Context exists.
- Standalone validation without Acceptance Context skips it.
- Acceptance Findings form one Acceptance Fixer batch.
- Every successor Candidate reruns Acceptance Review before later reviewer phases.

## What to build

Expand the complete gate so Task-backed validation inserts Pi Acceptance Review between Checks and Specialists.
Keep Acceptance Context exclusive to this role.

## Primary verification seam

Task-backed and standalone ordered-gate tests.

## Acceptance criteria

- [ ] Task-backed validation runs Prepare, Checks, Acceptance, Specialists, then Final in that order.
- [ ] Standalone validation without Acceptance Context skips Acceptance and retains the other phase order.
- [ ] Acceptance receives immutable Acceptance Context and no other reviewer role receives it.
- [ ] Acceptance Findings stop later phases for that Candidate and form one phase-local Fixer batch.
- [ ] A Fixer successor Candidate starts from Prepare and reruns Acceptance before Specialists.
- [ ] The Acceptance Fixer makes and records its decisions and attempts the complete batch without requesting Needs Input.
- [ ] If code verifies that the execution produced no clean successor Candidate, orchestration preserves the open Findings and records Needs Input after approved recovery is exhausted.
- [ ] Specialists start only after Acceptance passes on the current Candidate.
- [ ] Final starts only after applicable Acceptance passes and every Specialist is complete.
- [ ] The exact final Candidate has passing Acceptance evidence before publication.

## Open decisions to grill

- Built-in Acceptance prompt and Repo Config override contract.
- Acceptance Reviewer profile selection and output limits.
- Exact skipped-phase and Finding AXI inspection schema.

## Blocked by

- `docs/issues/083-start-eligible-task-backed-change-manually.md`
- `docs/issues/095-complete-final-review.md`
