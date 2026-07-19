# Recheck reviewer Findings without anchoring

## Status

Done.

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

- [x] A reviewer without earlier Findings uses one ordinary request.
- [x] A reviewer with earlier Findings first reviews the whole new Candidate without receiving them.
- [x] The second request receives the provisional report and only that reviewer's earlier Findings.
- [x] The second response is the sole authoritative report stored for the new Candidate.
- [x] Old Findings remain immutable history on their original Candidate.
- [x] V1 creates no Finding-ID reconciliation or resolution links.
- [x] Malformed final output receives the normal bounded output retry and then becomes a Tooling Failure.

## Completion

Implemented in `ec01782`.
Review correction completed in `2d63871`.
Spec review: Approved.
Standards review: Approved.
Quality: Passed - 321 tests, formatting, lint, architecture checks, typecheck, and Fallow checks.

## Blocked by

- `docs/issues/089-run-configured-specialists.md`
- `docs/issues/096-run-built-in-acceptance-review.md`
