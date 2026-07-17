# Add disposable Task Context drafts

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`

## Behaviors owned

- Agents can prepare a disposable editable copy of a Task's title and description before Task Start.
- Agents can apply a valid Task Context Draft to update a Task's title and description before Task Start.
- Task Context Drafts are local operational state rather than durable Task Context or Artifacts.

## What to build

Add non-interactive Task Context Draft commands that let an agent edit Task intent as a managed Markdown file.
`by task context draft <task-id>` creates the Task's one stable managed draft from its current title and description, replacing any prior draft and returning its path.
A valid draft starts with a first-line `# ` heading whose title is non-empty after trimming.
Its remaining body is non-empty after trimming and becomes the description exactly, excluding the one blank-line separator after the heading.
`by task context apply <task-id>` applies the draft atomically only while the Task is `todo`, before Task Start, and removes it after a successful apply.
It commits the Task update before removing the draft, so a failed cleanup retains the draft rather than losing it.
Comments remain append-only Task Context through `by task comment`.

## Primary verification seam

Task lifecycle CLI test in a temporary repository.

## Acceptance criteria

- [ ] `by task context draft <task-id>` creates a stable managed Markdown draft containing the Task's title and description.
- [ ] Repeating Draft replaces the prior managed draft with the Task's current title and description.
- [ ] `by task context apply <task-id>` updates title and description from a valid draft before Task Start.
- [ ] Apply rejects an invalid draft or a started or terminal Task without changing the Task Context, and retains the draft.
- [ ] Successful Apply removes the managed draft and exposes the Task's current state through structured output.
- [ ] Task Context Draft storage is shared across linked worktrees and is not tracked repository content.

## Blocked by

None - can start immediately.
