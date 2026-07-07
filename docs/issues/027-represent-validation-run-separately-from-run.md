# Replace generic Run with Validation Run

## Status

Not done.

## Parent

`docs/prds/task-authority-run-architecture-prd.md`

## What to build

Remove Run as a domain concept from the validation model.

A Validation Run is the domain record that validates one submitted commit through the Validation Gate.

A failed preflight does not create a Submission or a Validation Run.

A retry of the same commit creates a new Validation Run.

A new commit creates a new Validation Run.

Future loops should get their own explicit names instead of sharing a generic Run concept.

Do not introduce a shared higher-level loop concept in this issue.
Let one emerge later only if validation, implementation, and refinement prove they share real domain behavior.

This slice should make the validation-specific data model explicit before checks, rounds, Findings, and PR state grow further.

## Acceptance criteria

- [ ] Validation Run records represent validation of one submitted commit.
- [ ] Validation-specific fields are associated with Validation Run behavior.
- [ ] Submitted commit SHA is associated with the Validation Run.
- [ ] Phases, rounds, findings, logs, artifacts, and token usage are associated with the Validation Run.
- [ ] Existing local validation submit behavior remains unchanged.
- [ ] Existing validation workspace records remain associated with the Validation Run.
- [ ] Validation Run can record typed tooling errors separately from Findings.
- [ ] Validation Run phase status can represent Effect workflow failures without exposing Effect types publicly.
- [ ] Product-facing CLI and output names use Validation Run language, not generic Run language.
- [ ] `by run` is removed or renamed to `by validation-run`.
- [ ] Public IDs and artifact refs use `validationRunId` / `<validation-run-id>`, not `runId` / `<run-id>`.
- [ ] Findings are scoped to Validation Runs.
- [ ] Architecture and ADR docs do not keep generic Run as an accepted domain concept.
- [ ] Tests prove a submitted commit is tied to a Validation Run.
- [ ] Tests do not preserve generic Run as a public compatibility concept.
- [ ] No refinement or implementation loop behavior is added.
- [ ] No shared higher-level loop concept is added.

## Dependencies

- `docs/issues/026-move-validation-start-behind-validationruns.md` is done.
