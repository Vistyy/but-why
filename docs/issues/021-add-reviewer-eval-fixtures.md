# Add reviewer eval fixtures

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add golden fixtures for reviewer and finding behavior.

These fixtures should protect reviewer prompts, schema contracts, and expected blocking behavior from drift.

## Acceptance criteria

- [ ] Fixtures include Task Context, diff, and expected findings behavior.
- [ ] Fixtures cover intent mismatch.
- [ ] Fixtures cover no-finding success.
- [ ] Fixtures cover reviewer Findings.
- [ ] Fixtures cover invalid structured output corrected by retry.
- [ ] Fixtures cover Schema decode failure after structured-output retry is exhausted.
- [ ] Fixtures cover typed reviewer tooling failure separately from reviewer Findings.
- [ ] Eval output is stable enough for regression testing.
- [ ] Evals do not require live PR publishing.
- [ ] The fixture format is documented.

## Blocked by

- 014-add-intent-reviewer-agent.md
- 015-add-configurable-quality-reviewers.md
- `docs/issues/039-validate-config-and-reviewer-contracts-with-effect-schema.md`
