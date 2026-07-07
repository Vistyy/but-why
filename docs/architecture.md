# Architecture

But Why? is a repo-scoped validation workflow for agent-assisted code work.

It is task-based, not pipeline-based.

It validates submitted branches against Task Context and publishes only validated changes through GitHub PRs.

But Why is a domain-centered modular monolith with selective ports and adapters.
Domain-named modules and use cases sit at the center.
CLI output, SQLite, GitHub, and Sandcastle sit at the edges as adapters.
Ports are added only where behavior truly varies, such as Task Authority, Submission Environment, Validation Runs, Task Store, and Validation Run storage.

## Core domain

The core objects are:

- `Task`
- `Submission`
- `Validation Run`
- `Finding`
- `PR`

In v1, one Task belongs to one repo, one branch, and one PR.

One accepted `by submit <task-id>` creates one Submission and one Validation Run.

A failed preflight creates neither a Submission nor a Validation Run.

There is no public Submission ID in v1.

A Validation Run validates one submitted commit SHA.

A new commit creates a new Validation Run.

Retrying the same commit also creates a new Validation Run.

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

Validation Runs use Validation Run-owned temp refs and isolated worktrees.

Validation must not run against the checked-out task branch.

Tooling failures are recorded on the Validation Run and are not Findings.

After a tooling failure, the Task returns to its previous submit-eligible state.

## Findings

V1 Findings are blocking.

Any Finding sends the Task to `needs_input`.

V1 does not create follow-up Tasks from validation.

V1 does not pause and resume for human input.

A later `by submit <task-id>` starts a new Validation Run.

Finding fields are:

```text
title
description
severity: critical | high | medium | low
evidence
files
artifactRefs
```

Findings are stored on Validation Runs.

Task commands can show the latest Validation Run Findings without duplicating them as comments.

## Execution boundary

Sandcastle is the accepted v1 execution engine.

But Why? should use Sandcastle for:

- validation worktrees
- sandboxes
- command execution
- agent execution
- logs
- structured output retries
- token usage

But Why? should not reimplement those concerns.

## Code naming

File and type names should use the most specific product or code role name, not architecture vocabulary.
Avoid `Module` suffixes when a domain name fits.
For example, prefer names like `taskUseCases`, `submitPreflight`, or `cliResults` over names like `taskModule`, `submitModule`, or `cliResultModule`.

Effect is the accepted orchestration tool for validation workflow code.

Use Effect at validation workflow, adapter, resource lifecycle, retry, scheduling, concurrency, and schema-validation seams.

Do not expose Effect types from pure Task, Validation Run, Finding, or policy modules.

Validation workflows should preserve the domain distinction between Findings and Validation Tooling Failures.

Findings are validation results that block a Task.

Validation Tooling Failures are infrastructure, configuration, Sandcastle, Git, GitHub, or malformed external-output failures recorded on the Validation Run.

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

But Why validation config lives under `.but-why`.

A `.sandcastle/` directory is optional and only for low-level Sandcastle runtime assets.

Normal But Why validation must not require a tracked `.sandcastle/` directory.

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

Validation Run IDs are task-scoped operational names built from the canonical Task Slug plus the task validation number:

```text
by-1-09224d806043.v1
by-1-09224d806043.v2
```

Finding IDs are Validation Run-scoped:

```text
by-1-09224d806043.v2-F1
by-1-09224d806043.v2-F2
```

Artifact refs use this form:

```text
artifact:<validation-run-id>/<phase>/<producer>/<filename>
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

Validation Run and Task totals sum each bucket separately.

## CLI surface

The public CLI is `by`.

V1 command areas are:

```text
init
task
submit
validation-run
daemon
reconcile
```

CLI output is structured data on stdout.

TOON is the default stdout format for AXI-style agent shell use.

JSON is supported for programmatic CLI consumers through the CLI serializer boundary.

Command handlers return structured result objects before serialization.

Domain modules do not depend on TOON or JSON.

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
