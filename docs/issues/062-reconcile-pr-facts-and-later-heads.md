# Reconcile PR facts and later heads

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Reconcile an existing Change PR into durable readiness facts without occupying a coding slot or creating another PR.
Later heads and retargeted bases return through Candidate capture and validation.

## Acceptance criteria

- [ ] Reconciliation records open, draft, checks, reviews, mergeability, base, head, closed, and merged facts.
- [ ] `ready` requires the same PR to be open, non-draft, on the expected base, at the exact validated head, passing every required check, mergeable, and free of blocking review.
- [ ] Missing or pending readiness facts project `validating`, and merge projects `done`.
- [ ] External PR heads and retargeted bases extend Issue 051's shared capture capability with observed PR provenance instead of introducing separate Change discovery or Candidate capture logic.
- [ ] An external PR head creates a Candidate and remains ineligible until that exact head passes.
- [ ] A retargeted PR preserves the Change and PR, creates a replacement Candidate, and forces full validation.
- [ ] A validated successor head updates the same PR.
- [ ] Merge permanently closes the Change as `completed` and removes only clean managed workspaces.
- [ ] A closed unmerged PR records a blocker without silently closing the Change.

## Blocked by

- `docs/issues/040-add-effect-scheduled-github-polling.md`
- `docs/issues/061-publish-exact-validated-head-with-submit.md`
