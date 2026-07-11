# Capture and inspect a standalone Change

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

From a clean committed branch, find or create its open Change and capture the exact Candidate without requiring a Task or GitHub.
Expose the selected Change and Candidate through structured command output so the behavior is independently verifiable.

## Acceptance criteria

- [ ] A clean committed branch reuses its open Change or creates one when that branch has no Change history.
- [ ] Linked worktrees resolve the same Local Repository through the canonical Git common directory, and branch identity uses the full local ref.
- [ ] Repeated capture of the same branch and Git state is idempotent when Candidate provenance matches.
- [ ] Base selection uses the existing Change base, existing PR base, explicit override, then configured default branch.
- [ ] Candidate capture stores the selected base reference, resolved target SHA, exact comparison base, and head.
- [ ] Conflicting provenance for an existing Candidate identity returns a typed rejection without changing history.
- [ ] Task workspace metadata selects its linked Change before branch discovery.
- [ ] A proven branch rename preserves the open Change by rebinding it atomically.
- [ ] An unproven rename requires explicit rebind, and rebind rejects a destination that has any Change history.
- [ ] Closed Changes, ambiguous bindings, dirty work, and conflicting branch facts fail without guessing or changing Git state.
- [ ] Structured output identifies the Change ID, Candidate ID, branch, selected base provenance, comparison base, and head.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
