# Architecture

But Why? is a repo-scoped validation workflow for agent-assisted code work.

It is task-based, not pipeline-based.

It validates submitted branches against Task Context and publishes only validated changes through GitHub PRs.

## Core domain

The core objects are:

- `Task`
- `Run`
- `Finding`
- `PR`

In v1, one Task belongs to one repo, one branch, and one PR.

One `by submit <task-id>` creates one Run.

There is no public Submission ID in v1.

A Run validates one commit SHA.

A new commit creates a new Run.

## Task lifecycle

V1 Task states are:

```text
todo
implementing
validating
needs_input
ready
done
```

Task creation starts in `todo`.

`by task start <task-id>` moves `todo` to `implementing`.

`by submit <task-id>` is allowed from `implementing` and `needs_input`.

Any validation Finding moves the Task to `needs_input`.

A clean PR moves the Task to `ready`.

A merged PR moves the Task to `done`.

## Submission rules

V1 submission is explicit and branch-safe.

`by submit <task-id>` requires code to already be committed on a non-protected task branch.

It does not create, move, reset, or repair branches.

The first submit binds the Task to the current branch.

Later submits must use the same branch.

## Validation Gate

But Why? uses an opinionated Validation Gate with fixed phases.

It is not a generic CI pipeline language.

V1 phases are:

```text
preflight
checks
intent_review
quality_review
publish_pr
watch_pr
```

Config fills these phases but does not reorder them.

Checks run before reviewer agents to save tokens.

Checks are repo-owned commands.

V1 checks run sequentially and stop on first failure.

A failed check creates a blocking Finding.

Reviewer roles are configurable.

Intent review runs before quality review.

V1 has no auto-fix or repair phase.

V1 validation phases must not modify the submitted branch.

## Findings

V1 Findings are blocking.

Any Finding sends the Task to `needs_input`.

V1 does not create follow-up Tasks from validation.

V1 does not pause and resume for human input.

A later `by submit <task-id>` starts a new Run.

Finding fields are:

```text
title
description
severity: critical | high | medium | low
evidence
files
artifactRefs
```

Findings are stored on Runs.

Task commands can show the latest Run Findings without duplicating them as comments.

## Execution boundary

Sandcastle is the intended v1 execution engine, pending spike.

But Why? should use Sandcastle for:

- validation worktrees
- sandboxes
- command execution
- agent execution
- logs
- structured output retries
- token usage

But Why? should not reimplement those concerns.

Wrap Sandcastle only at But Why? domain seams.

Good seams speak But Why? language:

```text
createValidationWorkspace
runCheckRound
runReviewerRound
```

Avoid thick generic wrappers such as:

```text
createWorkspace
runCommand
runAgent
collectArtifacts
cleanup
```

## PR publishing and reconciliation

V1 always publishes through GitHub PRs.

If a GitHub PR target cannot be detected, `by submit <task-id>` fails during preflight.

But Why? opens or updates the PR, watches it until a clear outcome, and marks the Task `ready` when the PR is clean.

But Why? does not merge PRs.

V1 includes a repo-local PR reconciliation daemon:

```bash
by daemon
by reconcile
```

The daemon polls GitHub for PRs that But Why? created in the current repo.

It does not process new submissions in v1.

## Configuration

Repo config lives at:

```text
.but-why/config.json
```

Global config lives at:

```text
~/.config/but-why/config.json
```

Repo config owns validation behavior.

Global config owns user defaults.

Git facts such as base branch, publish remote, GitHub repository, and GitHub auth are detected at runtime.

Agent profiles use `agentRuntime` and `agentModel`.

Do not call these fields `provider` and `model`.

Pi model strings can already contain provider-like names.

Agent config precedence is:

```text
reviewer inline setting
  -> repo agent profile
  -> global agent profile
  -> error
```

## State and IDs

V1 state is repo-local.

The local database lives at:

```text
.but-why/state.sqlite
```

`by init` adds local state paths to `.gitignore`.

Task IDs use the init-time prefix:

```text
BY-1
BY-2
```

Run IDs are task-scoped:

```text
BY-1.1
BY-1.2
```

Finding IDs are run-scoped:

```text
BY-1.2-F1
BY-1.2-F2
```

Artifact refs use this form:

```text
artifact:<run-id>/<phase>/<producer>/<filename>
```

## Token accounting

V1 records tokens, not dollar costs.

Token usage is stored per producer and model:

```text
producerId
agentRuntime
agentModel
inputTokens
cachedInputTokens
outputTokens
totalTokens
```

Run and Task totals sum each bucket separately.

## CLI surface

V1 commands are:

```bash
by
by init
by task create --title "..." --description-file task.md
by task list
by task show <task-id>
by task context <task-id>
by task findings <task-id>
by task comment <task-id> --file comment.md
by task start <task-id>
by submit <task-id>
by run show <run-id>
by daemon
by reconcile
```

CLI output is TOON-style structured data on stdout.

Progress and diagnostics go to stderr.

## Deferred directions

These are intentionally not v1:

- Sandcastle-backed auto-fix and repair rounds
- full worker daemon where `by submit` enqueues work
- richer local board UI
- Kanboard, Linear, and GitHub Issues task-surface adapters
- push or gate-remote submission triggers
- webhook reconciliation
- token-to-dollar cost calculation
- screenshots, videos, and proof artifacts
- workspace-level coordination across multiple repo-scoped Tasks
- validation without PR publishing
- implementation code factory
