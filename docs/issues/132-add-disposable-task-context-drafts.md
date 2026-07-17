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

- [x] `by task context draft <task-id>` creates a stable managed Markdown draft containing the Task's title and description.
- [x] Repeating Draft replaces the prior managed draft with the Task's current title and description.
- [x] `by task context apply <task-id>` updates title and description from a valid draft before Task Start.
- [x] Apply rejects an invalid draft or a started or terminal Task without changing the Task Context, and retains the draft.
- [x] Successful Apply removes the managed draft and exposes the Task's current state through structured output.
- [x] Task Context Draft storage is shared across linked worktrees and is not tracked repository content.

## Completion

Implemented in `b2bf566d307e64a136c0704bfc61d8ab0693d900` with follow-up corrections in `65dfbabce3704b51eac5bb8c1bcc44fbe9104089` and `11252fa6d476ce7a13a4166a5600c2896328e93a`.
Spec review: Approved.
Standards review: Approved.

## Blocked by

None - can start immediately.
