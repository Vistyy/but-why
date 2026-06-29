# Create and list Tasks

## Parent

`docs/prd.md`

## What to build

Implement Task creation and basic Task visibility.

This should make But Why? useful as a repo-local Task store before validation exists.

## Acceptance criteria

- [ ] `by task create --title "..." --description-file <file>` creates a Task.
- [ ] Task title is required and non-empty.
- [ ] Task description file is required and non-empty.
- [ ] New Tasks start in `todo`.
- [ ] Task IDs use the configured task prefix.
- [ ] `by task list` shows non-done Tasks by default.
- [ ] `by task list --all` includes done Tasks.
- [ ] `by` shows only actionable dashboard items.
- [ ] Outputs are structured and agent-readable.

## Blocked by

- 003-implement-repo-initialization.md
