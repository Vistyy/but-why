# Create and list Tasks

## Status

Done.

## Parent

`docs/prd.md`

## What to build

Implement Task creation and basic Task visibility.

This should make But Why? useful as a repo-local Task store before validation exists.

## Acceptance criteria

- [x] `by task create --title "..." --description-file <file>` creates a Task.
- [x] Task title is required and non-empty.
- [x] Task description file is required and non-empty.
- [x] New Tasks start in `todo`.
- [x] Task IDs use the configured task prefix.
- [x] `by task list` shows non-done Tasks by default.
- [x] `by task list --all` includes done Tasks.
- [x] `by task list --state <state>` filters by state and implies `--all`.
- [x] `by` shows only actionable dashboard items.
- [x] Task summary output includes `id`, `title`, `state`, `createdAt`, and `updatedAt`.
- [x] List and dashboard output includes `count`.
- [x] Empty list and dashboard output exits `0` with explicit zero-count structured output.
- [x] Structured errors are written to stdout with actionable `help[...]`.
- [x] Usage errors exit `2`; runtime and state errors exit `1`.
- [x] CLI output tests cover create, list, empty list, bare dashboard, and structured errors.

## Resolved decisions

- Task summaries include `id`, `title`, `state`, `createdAt`, and `updatedAt`.
- Task titles are trimmed before validation and storage.
- Trimmed-empty titles are rejected.
- Internal title whitespace is preserved.
- Issue 004 does not impose a title length limit.
- `by task list`, bare `by`, and `by task create` use the same Task summary shape.
- `by task create` success output does not include the Task description.
- Empty `by` and empty `by task list` results exit `0` and return an explicit zero-count structured task list.
- List and dashboard outputs include a `count` field plus a `tasks[...]` table.
- `by task list` and bare `by` do not paginate or limit results in issue 004.
- Empty list and dashboard outputs include contextual `help[...]` with a complete command for creating a task.
- Non-empty list, dashboard, and mutation outputs may include contextual `help[...]` only for commands implemented by the current issue.
- `by task create` success output includes contextual help only for implemented commands, such as `by task list`.
- Bare `by` includes `bin` and `description` before live task data, following AXI home-view guidance.
- Structured errors use the same TOON-style pattern as repo initialization.
- Errors are written to stdout, not stderr.
- Usage errors exit `2`; runtime or state errors exit `1`.
- Issue 004 error codes are `not_initialized`, `invalid_repo_config`, `missing_title`, `empty_title`, `missing_description_file`, `description_file_not_found`, `description_file_unreadable`, `invalid_description_encoding`, `description_too_large`, `empty_description`, `invalid_task_state`, and `state_store_unavailable`.
- Missing setup fails with `not_initialized`.
- Malformed `.but-why/config.json` reuses issue 003's `invalid_repo_config` error code.
- Errors include actionable `help[...]` entries.
- Task IDs are monotonic per repo and are not reused.
- Failed validation before insert does not consume a Task ID.
- Gapless Task IDs are not required.
- Issue 004 adds SQLite migration `002_tasks`.
- SQLite storage uses snake_case column names; domain and CLI output use camelCase field names.
- The initial Task schema includes only `id`, `numericId`, `title`, `description`, `state`, `createdAt`, and `updatedAt`.
- The SQLite `tasks` table uses `id`, `numeric_id`, `title`, `description`, `state`, `created_at`, and `updated_at`.
- The `state` column has a database constraint allowing only `todo`, `implementing`, `validating`, `needs_input`, `ready`, or `done`.
- The `id` and `numeric_id` task columns are unique.
- Task creation reads the task prefix, allocates the Task ID, and inserts the task in one transaction.
- Concurrent task creation relies on SQLite transaction serialization; issue 004 does not add a separate application lock.
- SQLite open, migration, or query failures use `state_store_unavailable` without leaking raw dependency output.
- Task timestamps are UTC ISO 8601 strings, such as `2026-06-30T12:00:00.000Z`.
- `createdAt` and `updatedAt` are equal on create.
- Application code supplies timestamps instead of SQLite defaults, so tests can inject time.
- Branch, PR, Run, Finding, and comment storage are deferred to their own issues.
- Task create, list, and dashboard require initialized repo state but do not inspect Git worktree cleanliness.
- Branch safety and clean-worktree checks belong to submission, not issue 004.
- Bare `by` shows tasks in `todo`, `needs_input`, or `ready`.
- `by task list` supports `--state <state>` filtering.
- `by task list --state <state>` implies `--all`, so `--state done` works without also passing `--all`.
- Bare `by` does not support filters.
- Task descriptions are untrusted user-authored Markdown.
- Task description files resolve relative to the current working directory.
- Task description files may point outside the repository.
- Only description content is stored; the source file path is not stored.
- Task description files must exist, be readable, contain valid UTF-8, and be non-empty after trimming whitespace.
- Task description content is preserved exactly after UTF-8 decoding.
- Task description files do not need a `.md` extension.
- Task description files are limited to 256 KiB in v1.
- `by task list` sorts by `createdAt` ascending, then `numericId` ascending.
- Bare `by` sorts by action priority, then `updatedAt` descending.
- Bare `by` action priority is `needs_input`, `ready`, then `todo`.
- Output examples in this issue are semantic examples.
- The actual formatter output from the chosen TOON library wins when punctuation, quoting, or table syntax differs from these examples.
- Issue 004 requires CLI output tests for create, list, empty list, bare dashboard, and structured errors.
- Output tests should use exact stdout assertions when the TOON library output is deterministic.
- If harmless TOON library formatting differs, tests should assert the parsed structure instead.
- Output tests must verify summary fields, count fields, help presence where required, stdout error output, and exit codes.

## Output examples

`by task create --title "Add login" --description-file task.md` returns the created Task summary and implemented-command help:

```toon
task:
  id: BY-1
  title: Add login
  state: todo
  createdAt: 2026-06-30T12:00:00.000Z
  updatedAt: 2026-06-30T12:00:00.000Z
help[1]:
  Run `by task list` to see open tasks.
```

`by task list` returns all non-done Tasks sorted by creation order:

```toon
count: 2
tasks[2]{id,title,state,createdAt,updatedAt}:
  BY-1,Add login,todo,2026-06-30T12:00:00.000Z,2026-06-30T12:00:00.000Z
  BY-2,Fix logout,needs_input,2026-06-30T12:05:00.000Z,2026-06-30T12:10:00.000Z
```

An empty `by task list` returns an explicit zero-count result and creation help:

```toon
count: 0
tasks[0]{id,title,state,createdAt,updatedAt}:
help[1]:
  Run `by task create --title "..." --description-file <file>` to create a task.
```

Bare `by` returns the AXI home view plus actionable dashboard items:

```toon
bin: ~/.local/bin/by
description: Validate completed code changes against approved human intent.
count: 1
tasks[1]{id,title,state,createdAt,updatedAt}:
  BY-2,Fix logout,needs_input,2026-06-30T12:05:00.000Z,2026-06-30T12:10:00.000Z
```

Invalid task state filters are usage errors:

```toon
error:
  code: invalid_task_state
  message: Unknown task state blocked.
  state: blocked
help[1]:
  Use one of: todo, implementing, validating, needs_input, ready, done.
```

## Blocked by

- 003-implement-repo-initialization.md
