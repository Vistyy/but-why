# Show Task details and Task Context

## Parent

`docs/prd.md`

## What to build

Add read commands that separate compact Task metadata from full Task Context.

Agents should be able to inspect state cheaply and request full intent context only when needed.

## Acceptance criteria

- [ ] `by task show <task-id>` shows compact metadata.
- [ ] Compact metadata includes `id`, `title`, `state`, `createdAt`, and `updatedAt`.
- [ ] Compact metadata includes explicit future-backed fields as `null`: `branch`, `latestRun`, `tokenTotals`, and `commentCount`.
- [ ] `by task show` does not include description, comment IDs, comment bodies, or comment previews.
- [ ] `by task context <task-id>` shows only `id`, `title`, `description`, and `comments`.
- [ ] `by task context <task-id>` returns `comments: []` until comment storage exists.
- [ ] Missing and malformed Task IDs return structured actionable usage errors and exit `2`.
- [ ] Well-formed unknown Task IDs return structured actionable `task_not_found` errors and exit `1`.
- [ ] Detail output remains structured and suitable for agents.

## Output contract

`by task show <task-id>` returns compact metadata only:

```toon
task:
  id: BY-1
  title: ...
  state: todo
  createdAt: ...
  updatedAt: ...
  branch: null
  latestRun: null
  tokenTotals: null
  commentCount: null
```

`by task context <task-id>` returns full Task Context only:

```toon
task:
  id: BY-1
  title: ...
  description: ...
  comments: []
```

Later comments are returned as comment content in `by task context`, not as comment IDs only.

## Error contract

Missing Task ID arguments are usage errors and exit `2`.

Only public prefixed Task IDs with the exact uppercase prefix, such as `BY-1`, are accepted.

Internal numeric IDs are storage details and are not accepted by the CLI.

Lowercase IDs, such as `by-1`, are not normalized and are rejected as `invalid_task_id`.

Malformed Task IDs, such as `123` or `foo`, are rejected before store lookup as `invalid_task_id` usage errors and exit `2`.

Well-formed but unknown Task IDs, such as `BY-999`, return `task_not_found` and exit `1`.

All errors are structured, actionable, written to stdout, and use camelCase field names.

## Blocked by

- 004-create-and-list-tasks.md
