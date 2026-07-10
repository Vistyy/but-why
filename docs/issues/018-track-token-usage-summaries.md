# Track token usage summaries

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Expose token usage summaries at Validation Run and Task level.

Usage should stay split by producer, model, and token bucket because later dollar costs depend on those distinctions.

## Acceptance criteria

- [ ] Token usage stores producer ID, agent runtime, agent model, input tokens, cached input tokens, output tokens, and total tokens.
- [ ] `by validation-run show <validation-run-id>` shows full producer and model token usage for the Validation Run.
- [ ] `by task show <task-id>` shows task-level token totals across all Validation Runs.
- [ ] Task token summaries preserve input, cached input, output, and total buckets separately.
- [ ] Missing token fields from a runtime are represented consistently.
- [ ] Token usage records follow the Effect Schema contract used for reviewer output boundaries.
- [ ] Invalid token usage payloads are recorded as typed tooling errors.
- [ ] No dollar cost calculation is added.

## Blocked by

- `docs/issues/014-add-acceptance-reviewer-agent.md`
- `docs/issues/015-add-configurable-quality-reviewers.md`
- `docs/issues/039-validate-config-and-reviewer-contracts-with-effect-schema.md`
