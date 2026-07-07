# Validate config and reviewer contracts with Effect Schema

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Centralize runtime validation for configuration and reviewer contracts with Effect Schema.

The goal is to validate external data at boundaries and convert decode failures into typed validation workflow errors.

This should avoid hand-rolled JSON shape checks for config, reviewer output, Findings, and token usage records.

Sandcastle should still own structured output retry for reviewer agents.

But Why should validate the final structured output against its own contract before storing results.

## Acceptance criteria

- [ ] Repo config is decoded through Effect Schema or a schema built on the same contract.
- [ ] Global config is decoded through Effect Schema or a schema built on the same contract.
- [ ] Reviewer Finding output is decoded through Effect Schema.
- [ ] Token usage summaries are decoded or normalized through a documented schema contract.
- [ ] Schema decode errors become typed config or reviewer tooling errors.
- [ ] Invalid reviewer JSON after Sandcastle structured-output retry is exhausted records a tooling error, not a Finding.
- [ ] Schema validation errors are actionable enough for an agent to repair config or reviewer output.
- [ ] The public config examples in `docs/config.md` match the implemented schemas.
- [ ] Tests cover valid config, invalid config, valid reviewer Findings, and invalid reviewer output.

## Blocked by

- `docs/issues/037-introduce-validation-effect-error-taxonomy.md`
