# Track token usage summaries

## Parent

`docs/prd.md`

## What to build

Expose token usage summaries at Run and Task level.

Usage should stay split by producer, model, and token bucket because later dollar costs depend on those distinctions.

## Acceptance criteria

- [ ] Token usage stores producer ID, agent runtime, agent model, input tokens, cached input tokens, output tokens, and total tokens.
- [ ] `by run show <run-id>` shows full producer and model token usage for the Run.
- [ ] `by task show <task-id>` shows task-level token totals across all Runs.
- [ ] Task token summaries preserve input, cached input, output, and total buckets separately.
- [ ] Missing token fields from a runtime are represented consistently.
- [ ] No dollar cost calculation is added.

## Blocked by

- 012-add-intent-reviewer-agent.md
- 013-add-configurable-quality-reviewers.md
