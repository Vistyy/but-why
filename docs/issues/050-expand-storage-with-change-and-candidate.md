# Expand storage with Change and Candidate

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Add durable Change and Candidate records beside the current Task-owned validation records.
This is the expand step of the ownership migration, so current behavior remains green while later slices adopt the new records.

## Acceptance criteria

- [ ] A Change records repository identity, branch binding, lifecycle facts, and an optional linked Task.
- [ ] Storage enforces at most one open Change for one repository branch.
- [ ] A Candidate records its Change, selected base reference, resolved target SHA, comparison-base SHA, and exact head SHA.
- [ ] Starting a replacement Change atomically supersedes the prior open Change and preserves its history.
- [ ] Closed and superseded Changes remain readable and are not reused.
- [ ] Current Task-owned validation records and commands continue to work during expansion.
- [ ] Schema migration and store tests cover existing and newly initialized repositories.

## Blocked by

None - can start immediately
