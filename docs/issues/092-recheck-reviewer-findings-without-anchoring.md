# Recheck reviewer Findings without anchoring

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- A reviewer examines a new Candidate blindly before checking its own earlier Findings.
- One final fresh report replaces protocol-level Finding reconciliation.

## What to build

Extend Acceptance and Specialist reviews of successor Candidates with the approved two-request revision session.

## Primary verification seam

Fake reviewer revision test for Acceptance and one Specialist.

## Acceptance criteria

- [ ] A reviewer without earlier Findings uses one ordinary request.
- [ ] A reviewer with earlier Findings first reviews the whole new Candidate without receiving them.
- [ ] The second request receives the provisional report and only that reviewer's earlier Findings.
- [ ] The second response is the sole authoritative report stored for the new Candidate.
- [ ] Old Findings remain immutable history on their original Candidate.
- [ ] V1 creates no Finding-ID reconciliation or resolution links.
- [ ] Malformed final output receives the normal bounded output retry and then becomes a Tooling Failure.

## Blocked by

- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/096-run-built-in-acceptance-review.md`
