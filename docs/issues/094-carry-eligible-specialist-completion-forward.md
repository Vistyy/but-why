# Carry eligible Specialist completion forward

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- Clean Specialist evidence may carry across eligible automatic Fixer successors.
- New adopted Task Comments reset every Specialist completion.
- Reuse preserves original Candidate and reviewer provenance rather than copying evidence.

## What to build

Add one explicit eligibility decision for each completed Specialist when a successor Candidate reaches the Specialist phase.
Keep Acceptance Context unavailable to the Specialist while using its adopted revision identity as an invalidation fact.

## Primary verification seam

Eligibility matrix integration test.

## Acceptance criteria

- [ ] Eligible linear automatic Fixer successors reuse clean Specialist completion.
- [ ] Reuse requires matching Change, comparison base, concern, instructions, Agent Profile, validation policy, and adopted Task Context revision.
- [ ] New adopted Task Comments reset every Specialist completion before the new implementation cycle is reviewed.
- [ ] A new Change, non-linear history, changed base, changed concern, changed instructions, changed profile, or changed policy resets affected completion.
- [ ] Reset never sends Acceptance Context to a Specialist.
- [ ] Reused evidence retains its original Candidate, Run, Attempt, Producer, Artifacts, and usage provenance.
- [ ] Inspection distinguishes executed-on-current-Candidate from carried eligible completion.
- [ ] Final Review still runs fresh on the exact final Candidate.

## Open decisions to grill

- Canonical equality rules for Specialist instructions and Agent Profiles.
- Exact reuse explanation and provenance AXI schema.

## Blocked by

- `docs/issues/089-run-one-configured-pi-specialist.md`
- `docs/issues/091-fix-check-findings-with-pi.md`
