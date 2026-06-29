# Add Task comments

## Parent

`docs/prd.md`

## What to build

Add append-only Task comments as freeform Task Context.

Comments should be readable by humans and agents, but should not change Task state.

## Acceptance criteria

- [ ] `by task comment <task-id> --file <file>` appends a comment.
- [ ] Comment file content is required and non-empty.
- [ ] Comments are append-only.
- [ ] Comments do not change Task state.
- [ ] Comments are included in `by task context <task-id>`.
- [ ] Comments are allowed in every Task state.

## Blocked by

- 005-show-task-details-and-context.md
