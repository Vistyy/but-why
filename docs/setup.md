# Setup

> This document describes setup for the currently implemented workflow.
> Task 123 updates it when the reduced Change-centered v1 is implemented.


## Install from a local tarball

But Why? is not available from the npm registry until issue 046 publishes the package.

Build a local install tarball from the latest checkout:

```bash
just pack
```

Install that tarball in another repository:

```bash
npm install /path/to/but-why-0.0.0.tgz
npx by --help
```

Install the same tarball under a global npm prefix when you need `by` on `PATH`:

```bash
npm install --global /path/to/but-why-0.0.0.tgz
by --help
```

Use the installed `by` command from repositories that use But Why?.
Use `just by ...` only when developing But Why? itself from this source checkout.

For agent-facing setup in issue 041, give agents a tarball path or a `by` on `PATH` from the tarball install above.
Agents should run the Installed CLI as `by ...` inside the target repository, not the source checkout wrapper.

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

Use `docs/config.md` for configuration details.

## What init creates

`by init` creates tracked worktree files:

```text
.but-why/config.json
.but-why/reviewers/
```

It creates SQLite state and Artifacts in the Git common directory shared by every linked worktree:

```text
<git-common-dir>/but-why/
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

Agent-assisted setup asks whether to use the setup agent's current harness or another supported harness without scanning the machine.
It updates `~/.config/but-why/config.json` directly, preserves existing settings and profiles, and sets `defaultAgentProfile` to a matching or newly created Agent Profile.
All current adapters require a model.

Repo init may succeed without an Agent Profile.
Profiles are resolved and validated only when an operation needs an agent.

See `docs/public/setup.md` for the setup procedure and `docs/config.md` for profile paths and precedence.

## First expected workflow

Create a task:

```bash
by task create --title "Fix login redirect" --description-file task.md
```

Approve the task intent:

```bash
by task approve BY-1
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
