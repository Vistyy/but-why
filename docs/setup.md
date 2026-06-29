# Setup

This document describes the intended v1 setup flow for But Why?.

But Why? is not implemented yet.

These commands describe the planned interface.

## Setup

Setup is non-interactive:

```bash
by init --task-prefix BY
```

The prefix is required because task IDs are generated from it.

Example task IDs:

```text
BY-1
BY-2
```

Agents should follow this document and `AGENTS.md` before running setup.

## What init creates

`by init` creates repo-local But Why files:

```text
.but-why/config.json
.but-why/state.sqlite
.but-why/reviewers/
```

It also updates `.gitignore` for local state:

```text
.but-why/state.sqlite
.but-why/logs/
.but-why/worktrees/
```

Config and reviewer instructions are not ignored by default.

Users may commit them if they want shared repo behavior.

## GitHub requirement

V1 requires a GitHub PR target.

But Why detects Git facts at runtime:

- base branch
- publish remote
- GitHub repository
- GitHub auth

If any required GitHub fact cannot be detected, `by submit <task-id>` fails during preflight.

## Global agent profiles

Reviewer agents use agent profiles.

Global profiles live at:

```text
~/.config/but-why/config.json
```

Repo profiles live in:

```text
.but-why/config.json
```

Repo init may succeed without an agent profile.

`by submit <task-id>` fails if a required reviewer profile cannot be resolved.

## First expected workflow

Create a task:

```bash
by task create --title "Fix login redirect" --description-file task.md
```

Start the task:

```bash
by task start BY-1
```

Implement the change on a non-protected task branch.

Commit the change.

Submit it:

```bash
by submit BY-1
```

If validation finds anything, the task moves to `needs_input`.

After fixing or clarifying, submit the same task again:

```bash
by submit BY-1
```

When the PR is clean, the task moves to `ready`.

A human merges the PR.

The repo-local daemon later reconciles the merged PR to `done`.

## Daemon

V1 has a repo-local PR reconciliation daemon:

```bash
by daemon
```

It polls GitHub for PRs created by But Why in the current repo.

It does not process new submissions in v1.

Run a one-shot reconciliation with:

```bash
by reconcile
```
