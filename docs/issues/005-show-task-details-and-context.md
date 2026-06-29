# Show Task details and Task Context

## Parent

`docs/prd.md`

## What to build

Add read commands that separate compact Task metadata from full Task Context.

Agents should be able to inspect state cheaply and request full intent context only when needed.

## Acceptance criteria

- [ ] `by task show <task-id>` shows compact metadata.
- [ ] Compact metadata includes state, title, branch if any, latest run summary if any, and token totals if any.
- [ ] `by task show` does not include description or comment previews.
- [ ] `by task context <task-id>` shows title, description, and comments.
- [ ] Missing Task IDs return structured actionable errors.
- [ ] Detail output remains structured and suitable for agents.

## Blocked by

- 004-create-and-list-tasks.md
