# Verify one reviewer revision

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0008-use-change-as-validation-and-delivery-owner.md`

## Behaviors owned

- A reviewer with prior Findings uses a fresh two-request revision session.
- Blind review runs before prior Findings are disclosed.
- The second response is the authoritative open-Finding set.
- Old Findings remain immutable and are resolved only through links.

## What to build

Add the shared reviewer revision protocol and exercise it through one Specialist successor review.
Keep the provisional blind response as session evidence without persisting it as the final Finding set.

## Primary verification seam

One-Specialist revision test with duplicate and resolved Findings.

## Acceptance criteria

- [ ] A successor review starts a fresh session with no prior Finding content in the first request.
- [ ] The blind response is retained as an Artifact but does not create final Findings.
- [ ] The second request receives the provisional blind result and only that reviewer's prior Finding IDs and content.
- [ ] The second response returns one complete authoritative open-Finding set.
- [ ] A retained prior ID keeps that immutable Finding open.
- [ ] An omitted prior ID creates a resolution link from the current reviewer result.
- [ ] An entry without a prior ID creates one new Finding.
- [ ] A blind duplicate of an old unresolved Finding returns the old ID instead of creating another Finding.
- [ ] Unknown or duplicate prior IDs receive one structured-output retry.
- [ ] Exhausted invalid output ends the Attempt with a Reviewer Output Contract Failure.
- [ ] Acceptance, Specialist, and Final Reviewer reruns can reuse the same protocol.

## Open decisions to grill

- Exact authoritative output schema and provisional Artifact format.
- Evidence stored on resolution links.
- Content limits for prior Findings and provisional results.

## Blocked by

- `docs/issues/089-run-one-configured-pi-specialist.md`
- `docs/issues/091-fix-check-findings-with-pi.md`
