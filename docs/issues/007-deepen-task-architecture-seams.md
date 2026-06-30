# Deepen Task architecture seams

## Parent

`docs/prd.md`

## What to build

Deepen the modules that future Task lifecycle and submission work will use.

Do this after Task comments, before Task start and submit preflight.

This issue should not add new user-facing commands.
It should preserve the behavior delivered by issues 003 through 006.

Deepen repo-local state setup first.
The module should concentrate Git root discovery, repo config validation, task prefix policy, local state paths, reviewers path, and repo-local repair rules.
Callers should not rebuild `.but-why/config.json` or `.but-why/state.sqlite` paths themselves.

Deepen durable state second.
The module should concentrate SQLite lifecycle, migrations, transactions, ID allocation, row validation, and Task state transition rules.
Tests should cross the same durable state seam as callers instead of mutating SQLite directly for Task behavior.

Deepen the Task command module third.
CLI parsing and TOON rendering should stay at the CLI edge.
Task lookup, Task Context loading, Actionable Dashboard Item policy, comments, and Task lifecycle behavior should sit behind a Task-shaped module interface.

Do not introduce generic execution seams in this issue.
Sandcastle execution remains behind But Why domain seams in later validation work.

## Acceptance criteria

- [ ] Existing `by init`, `by`, `by task create`, `by task list`, `by task show`, `by task context`, and `by task comment` behavior is preserved.
- [ ] Repo-local state setup has one module interface for initialization and loading repo-local But Why context.
- [ ] Task command code no longer rebuilds repo config and state paths directly.
- [ ] Task prefix validation policy is owned by repo-local state setup rather than duplicated at command call sites.
- [ ] Durable state has one module interface for Task persistence behavior needed by existing commands.
- [ ] SQLite lifecycle and migration setup are hidden behind the durable state module interface.
- [ ] Task row validation is hidden behind the durable state module interface.
- [ ] Tests for Task behavior do not mutate SQLite directly to force Task states.
- [ ] The Task command module keeps CLI parsing and TOON rendering at the CLI edge.
- [ ] Task lookup, Task Context, Actionable Dashboard Item ordering, and comment behavior are exercised through Task-shaped module behavior.
- [ ] The new module shape is documented enough for issue 008 and issue 009 implementers to use it without rediscovering the old call graph.
- [ ] No Sandcastle execution plumbing is added.

## Blocked by

- 006-add-task-comments.md
