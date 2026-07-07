# Represent Validation Run separately from Run

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Separate generic Run history from validation-specific records.

A Run is a durable execution record for a Task.

A Validation Run is the validation-specific record that validates one submitted commit through the Validation Gate.

This slice should keep current behavior while making the validation-specific data model explicit before checks, rounds, Findings, and PR state grow further.

## Acceptance criteria

- [ ] Run records represent generic execution history.
- [ ] Validation Run records represent validation of one submitted commit.
- [ ] Validation-specific fields are associated with Validation Run behavior instead of generic Run behavior where practical.
- [ ] Existing local validation submit behavior remains unchanged.
- [ ] Existing Run IDs remain usable for current CLI behavior.
- [ ] Existing validation workspace records remain associated with the validation attempt.
- [ ] Validation Run can record typed tooling errors separately from Findings.
- [ ] Validation Run phase status can represent Effect workflow failures without exposing Effect types publicly.
- [ ] Tests prove a submitted commit is tied to a Validation Run.
- [ ] Tests prove existing run inspection behavior remains compatible.
- [ ] No refinement or implementation loop behavior is added.

## Blocked by

- `docs/issues/026-move-validation-start-behind-validationruns.md`
