# Add automatic Change and Candidate capture

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Build the internal application capability that automatically finds or creates the open Change for a clean committed branch and captures its exact Candidate without requiring a Task or GitHub.
Return the selected Change and Candidate as structured application data so later `by validate`, `by submit`, Task, and background-worker flows can use the same behavior.

## Acceptance criteria

- [ ] A clean committed branch reuses its open Change or creates one when that branch has no Change history.
- [ ] Linked worktrees resolve the same Local Repository through the canonical Git common directory, and branch identity uses the full local ref.
- [ ] Repeated capture of the same branch and Git state is idempotent when Candidate provenance matches.
- [ ] Base selection uses the existing Change base, existing PR base, explicit override, then configured default branch.
- [ ] Candidate capture stores the selected base reference, resolved target SHA, exact comparison base, and head.
- [ ] Conflicting provenance for an existing Candidate identity returns a typed rejection without changing history.
- [ ] A proven branch rename preserves the open Change by rebinding it atomically.
- [ ] An unproven rename requires explicit rebind, and rebind rejects a destination that has any Change history.
- [ ] Closed Changes, ambiguous bindings, dirty work, and conflicting branch facts fail without guessing or changing Git state.
- [ ] The application result identifies the Change ID, Candidate ID, branch, selected base provenance, comparison base, and head.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
