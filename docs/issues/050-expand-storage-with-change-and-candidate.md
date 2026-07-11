# Expand storage with Change and Candidate

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Add durable Change and Candidate records beside the current Task-owned validation records.
This is the expand step of the ownership migration, so current behavior remains green while later slices adopt the new records.

## Acceptance criteria

- [x] A Change has a permanent opaque ID and records its canonical Git common-directory identity, full local branch ref, lifecycle facts, and optional linked Task.
- [x] Change state is `open` or `closed`; a closed Change records `completed` or `cancelled` and when it closed.
- [x] Storage rejects invalid lifecycle combinations and never reopens a closed Change.
- [x] Storage enforces at most one Change for one repository branch, at most one Change for one Task, and at most one Task for one Change.
- [x] A Candidate has a permanent opaque ID and records its Change, selected base reference, resolved target SHA, comparison-base SHA, and exact head SHA.
- [x] Candidate identity is unique by Change, comparison-base SHA, and head SHA.
- [x] Repeated Candidate capture with matching provenance reuses the record, while conflicting provenance is rejected without changing history.
- [x] Closed Changes remain readable and accept no new Candidates.
- [x] Current Task-owned validation records and commands continue to work during expansion.
- [x] Schema migration and store tests cover existing and newly initialized repositories.

## Blocked by

None - can start immediately
