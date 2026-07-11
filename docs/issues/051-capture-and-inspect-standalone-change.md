# Capture and inspect a standalone Change

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

From a clean committed branch, find or create its open Change and capture the exact Candidate without requiring a Task or GitHub.
Expose the selected Change and Candidate through structured command output so the behavior is independently verifiable.

## Acceptance criteria

- [ ] A clean committed branch reuses its open Change or creates one when none exists.
- [ ] Repeated capture of the same branch and Git state is idempotent.
- [ ] Base selection uses the existing Change base, existing PR base, explicit override, then configured default branch.
- [ ] Candidate capture stores the selected base reference, resolved target SHA, exact comparison base, and head.
- [ ] Task workspace metadata selects its linked Change before branch discovery.
- [ ] Ambiguous bindings, dirty work, and conflicting branch facts fail without guessing or changing Git state.
- [ ] The replacement-Change domain operation can supersede the current open Change without requiring a separate abandonment operation.
- [ ] Structured output identifies the Change, Candidate, branch, selected base provenance, comparison base, and head.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
