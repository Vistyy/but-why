# Deepen Task architecture seams

## Status

Done.

## Parent

`docs/prd.md`

## What to build

Deepen the modules that future Task lifecycle and submission work will use.

Do this after Task comments, before Task start and submit preflight.

This issue should not add new user-facing commands.
It should preserve the behavior delivered by issues 003 through 006.
Treat the completed issue 006 behavior as part of the baseline.
The refactor must preserve Task comment persistence, comment counts, and `by task context` comment output.

Current likely touchpoints include `src/init/initRepo.ts`, `src/init/stateDatabase.ts`, `src/task/taskCli.ts`, `src/task/taskStore.ts`, `src/task/task.ts`, and `src/task/taskId.ts`.
The goal is not merely moving functions between files.
Callers should depend on a small repo-local context interface and a small durable Task state interface, not raw paths, raw SQLite connections, or migration details.

Deepen repo-local state setup first.
The module should concentrate Git root discovery, repo config validation, task prefix policy, local state paths, reviewers path, and repo-local repair rules.
Callers should not rebuild `.but-why/config.json` or `.but-why/state.sqlite` paths themselves.

Deepen durable state second.
The module should concentrate SQLite lifecycle, migrations, transactions, ID allocation, row validation, and Task state transition rules.
The durable state module should make issue 008 implementable without direct SQL updates by exposing or preparing a Task state transition path for `todo -> implementing` and idempotent `implementing`.
Tests should cross the same durable state seam as callers instead of mutating SQLite directly for Task behavior.

Deepen the Task command module third.
CLI parsing and TOON rendering should stay at the CLI edge.
Task lookup, Task Context loading, Actionable Dashboard Item policy, comments, and Task lifecycle behavior should sit behind a Task-shaped module interface.

Do not introduce generic execution seams in this issue.
Sandcastle execution remains behind But Why domain seams in later validation work.

## Acceptance criteria

- [x] Existing `by init`, `by`, `by task create`, `by task list`, `by task show`, `by task context`, and `by task comment` behavior is preserved.
- [x] Repo-local state setup has one module interface for initialization and loading repo-local But Why context.
- [x] Task command code no longer rebuilds repo config and state paths directly.
- [x] Task prefix validation policy is owned by repo-local state setup rather than duplicated at command call sites.
- [x] Durable state has one module interface for Task persistence behavior needed by existing commands.
- [x] SQLite lifecycle and migration setup are hidden behind the durable state module interface.
- [x] Task row validation is hidden behind the durable state module interface.
- [x] Tests for Task behavior do not mutate SQLite directly to force Task states.
- [x] Tests verify preserved behavior through CLI-level commands or the new Task-shaped module interface, including create, list, dashboard actionability, show, context, and comments.
- [x] The Task command module keeps CLI parsing and TOON rendering at the CLI edge.
- [x] Task lookup, Task Context, Actionable Dashboard Item ordering, and comment behavior are exercised through Task-shaped module behavior.
- [x] The new module shape is documented enough for issue 008 and issue 009 implementers to use it without rediscovering the old call graph.
- [x] A short module-level note in the relevant source file or project documentation explains which module future Task lifecycle commands should call for Task lookup, state transitions, Task Context, and persistence.
- [x] No Sandcastle execution plumbing is added.

## Blocked by

- 006-add-task-comments.md
