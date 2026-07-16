# Add Task comments

## Status

Done.

This issue records the implemented Task-owned behavior.
The reduced v1 lifecycle makes Task Context immutable at Task Start.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add append-only Task comments as freeform Task Context.

Comments should be readable by humans and agents, but should not change Task state.

V1 stores comments as append-only internal records with an opaque ID, creation time, and Markdown content.
Internal comment IDs carry no domain meaning and do not encode order, time, or task identity.
Comment `createdAt` is assigned at successful append/write time.
Failed append attempts do not create comment records and do not update Task `updatedAt`.
Adding a comment updates Task `updatedAt`, but does not change Task state.
Task Context output exposes comments as an ordered array of Markdown strings, not public comment records.
Task Context does not expose comment IDs or timestamps in v1.
Task Context lists comments oldest-first by append order.
`by task comment` returns only task-level confirmation on stdout and does not expose the new internal comment ID.
The success response includes `commentCount`.
The success response shape is:

```toon
task:
  id: <task-id>
  commentCount: <count>
```

Because no existing task mutation success output includes `updatedAt` yet, v1 `by task comment` success output does not include `updatedAt`.
The input file path is not stored as comment metadata.
Malformed task IDs fail as `invalid_task_id` usage errors with exit code 2.
Well-formed unknown task IDs use the existing structured `task_not_found` error contract with exit code 1.
File input failures are structured and actionable on stdout for missing files, unreadable files, and content that is empty after trimming whitespace.
Debug/progress diagnostics, if any, go to stderr and never replace the structured stdout error.
File input failures use exit code 1.
Missing required flags use exit code 2.
Comment emptiness validation trims whitespace, but stored Markdown preserves the original file content.
Stored comment content preserves the original file content exactly, with no newline normalization.
Duplicate comment content is allowed.
`commentCount` counts comment records, including duplicate content.
V1 does not support editing or deleting comments.
Comments are Task Context, not validation Findings.
Comments do not affect dashboard actionability and do not trigger validation or revalidation.
V1 validation still starts through `by submit <task-id>`.
Reviewer prompt context for future submissions includes comments because comments are Task Context.
This issue does not add historical Run context snapshots.
`by task show` reports the updated `commentCount`, but does not include comment bodies.
Once comment storage exists, existing tasks behave as having `comments: []` and `commentCount: 0`, replacing the temporary `commentCount: null` behavior from issue 005.
`by task list` does not add comment counts in this issue.
`--file -` stdin input is not supported in this issue.
Relative file paths resolve from the current working directory.
Markdown content is stored and returned raw without parsing or sanitization.
This issue does not add a new comment size limit.
If storage already has a general field limit, use that existing limit.
Non-UTF-8 files are treated as unreadable input unless the existing CLI has a text-decoding policy.
Symlinks use normal filesystem read behavior.
Concurrent appends preserve all comments, ordered by successful write order.
Comments are visible in `by task context` immediately after append across CLI processes.
This issue does not decide whether comments appear in PR descriptions.

## Acceptance criteria

- [x] `by task comment <task-id> --file <file>` appends a comment and returns only structured task-level confirmation on stdout without a comment ID.
- [x] Malformed task IDs fail as structured `invalid_task_id` usage errors with exit code 2.
- [x] Well-formed unknown task IDs fail with the existing structured `task_not_found` error contract and exit code 1.
- [x] Missing comment files fail with a structured, actionable stdout error and exit code 1.
- [x] Unreadable comment files fail with a structured, actionable stdout error and exit code 1.
- [x] Comment file content is required and non-empty after trimming whitespace, otherwise the command fails with a structured, actionable stdout error and exit code 1.
- [x] Missing required flags fail with structured, actionable stdout errors and exit code 2.
- [x] Debug/progress diagnostics, if any, go to stderr and never replace structured stdout output.
- [x] Comments are append-only.
- [x] Duplicate comment content is allowed.
- [x] `commentCount` counts comment records, including duplicate content.
- [x] Comments cannot be edited or deleted in v1.
- [x] Comment `createdAt` is assigned at successful append/write time.
- [x] Failed append attempts do not create comment records.
- [x] Failed append attempts do not update Task `updatedAt`.
- [x] Adding a comment updates Task `updatedAt`.
- [x] Comments do not change Task state.
- [x] Comments are included in `by task context <task-id>` as oldest-first Markdown content.
- [x] `by task context <task-id>` does not expose comment IDs or timestamps in v1.
- [x] `by task comment <task-id> --file <file>` success output includes `commentCount`.
- [x] `by task comment <task-id> --file <file>` success output does not include `updatedAt` in v1.
- [x] Comments are allowed in every Task state, including `done`.
- [x] Comments are Task Context, not validation Findings.
- [x] Existing tasks without comments behave as having `comments: []` and `commentCount: 0` once comment storage exists.
- [x] `by task show <task-id>` reports the updated `commentCount` after comments are added.
- [x] `by task show <task-id>` does not include comment bodies.
- [x] `by task list` does not add comment counts in this issue.
- [x] Comments do not affect dashboard actionability.
- [x] Adding a comment does not trigger validation or revalidation.
- [x] Reviewer prompt context for future submissions includes comments.
- [x] This issue does not add historical Run context snapshots.
- [x] `--file -` stdin input is not supported in this issue.
- [x] Relative file paths resolve from the current working directory.
- [x] Markdown content is stored and returned raw without parsing, sanitization, or newline normalization.
- [x] This issue does not add a new comment size limit.
- [x] Existing storage field limits still apply if present.
- [x] Non-UTF-8 files are treated as unreadable input unless the existing CLI has a text-decoding policy.
- [x] Symlinks use normal filesystem read behavior.
- [x] Concurrent appends preserve all comments and order them by successful write order.
- [x] Comments are visible in `by task context <task-id>` immediately after append across CLI processes.
- [x] This issue does not decide whether comments appear in PR descriptions.
- [x] Tests cover persistence across CLI invocations.

## Blocked by

- 005-show-task-details-and-context.md
