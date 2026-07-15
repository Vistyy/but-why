# Configuration

This document describes the v1 configuration model.

## Config files

Repo config lives at:

```text
.but-why/config.json
```

Global config lives at:

```text
~/.config/but-why/config.json
```

Repo config owns validation behavior.

Global config owns reusable local settings such as Agent Profiles.
Global config is not a fallback for repo validation policy.

Repo and global config should be validated at their read boundaries with Effect Schema.

But Why validation config lives under `.but-why`.

A `.sandcastle/` directory is optional and only for low-level Sandcastle runtime assets, such as a custom Dockerfile.

But Why should not require a tracked `.sandcastle/` directory for normal validation.

## Git facts are detected

Repo config should not duplicate Git facts unless there is a later proven need.

But Why detects these at runtime:

- base branch
- publish remote
- GitHub repository
- GitHub auth

V1 requires a GitHub PR target.

If detection fails, `by submit <task-id>` fails during preflight.

## Repo config example

```json
{
  "taskPrefix": "BY",
  "validation": {
    "sandbox": {
      "mode": "none"
    },
    "prepare": {
      "command": "pnpm install --frozen-lockfile --prefer-offline",
      "timeoutSeconds": 1200
    },
    "checks": [
      {
        "id": "quality",
        "command": "just quality",
        "timeoutSeconds": 1200
      }
    ]
  },
  "review": {
    "intent": {
      "reviewer": "intent"
    },
    "quality": {
      "mode": "parallel",
      "reviewers": ["bugs"]
    }
  },
  "reviewers": {
    "intent": {
      "agentProfile": "strict-reviewer",
      "instructionsFile": ".but-why/reviewers/intent.md"
    },
    "bugs": {
      "instructionsFile": ".but-why/reviewers/bugs.md"
    }
  },
  "validationWorkspace": {
    "copyFiles": [".env.test", "config/local-validation.json"]
  }
}
```

The exact reviewer roles are not fixed by architecture.

The default roles created by `by init` are still an open question.

## Agent profiles

Agent profiles choose how reviewer agents run.

Use `agentRuntime` and `agentModel`.

Do not use `provider` and `model` for these fields.

Pi model strings can already contain provider-like names.

Example global config:

```json
{
  "defaultAgentProfile": "pi",
  "agentProfiles": {
    "pi": {
      "agentRuntime": "pi",
      "agentModel": "openai-codex/gpt-5.5",
      "thinking": "medium"
    }
  }
}
```

Repo config may also define profiles:

```json
{
  "agentProfiles": {
    "strict-reviewer": {
      "agentRuntime": "pi",
      "agentModel": "anthropic/claude-sonnet-4",
      "thinking": "high"
    }
  }
}
```

A reviewer defines `instructionsFile` and may select a named profile through `agentProfile`.
An explicit selection resolves Repo Config profiles before Global Config profiles.
A reviewer without `agentProfile` uses `defaultAgentProfile`, which resolves from Global Config only.
For Pi-backed reviewers, `thinking` is one of `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
Other runtimes accept a non-empty runtime-defined `thinking` value.
The supported runtimes are `pi`, `claude-code`, `codex`, `cursor`, `opencode`, and `copilot`.
All current adapters require `agentModel` when an operation runs an agent.
Profile semantic validation is lazy so unrelated commands remain usable.

## Validation workspace

Repo config may allowlist ordinary untracked or ignored regular files to copy into the validation workspace.

These paths are normalized repository-relative paths.
Tracked files, missing paths, directories, symbolic links, non-regular files, duplicate normalized paths, and paths outside the repository are Submit Rejections before Run creation.
When `validationWorkspace` is present, `copyFiles` contains at least one path.

Each path's raw-byte SHA-256 and executable bit become immutable Run inputs.
An Attempt verifies the identity while copying the file into the Sandcastle worktree before validation commands or reviewers run.

Example:

```json
{
  "validationWorkspace": {
    "copyFiles": [".env.test", "config/local-validation.json"]
  }
}
```

V1 should not copy untracked files automatically.

A file that changes after selection triggers one automatic complete input reselection.
If a stable replacement input set cannot be selected, the Change records Needs Input rather than a Validation Tooling Failure.

Copied files are not part of the submitted commit SHA.
Their contents are not stored in SQLite.

## Validation sandboxing

Repo config chooses validation execution sandboxing with `validation.sandbox.mode`.

Missing `validation.sandbox.mode` defaults to `none`.

The sandbox mode is repo-level validation execution policy, not per-check config.

`none` means no Docker or Podman sandbox, but checks still run inside the Validation Workspace.

Example:

```json
{
  "validation": {
    "sandbox": {
      "mode": "none"
    }
  }
}
```

Supported v1 modes are:

```text
none
docker
podman
```

Invalid modes are Submit Rejection Errors before Validation Run creation.

Requested modes that are unavailable at runtime are Validation Tooling Failures.

Validation commands run from the repo root inside the Validation Workspace.

## Prepare

Prepare is an optional repo-owned command at `validation.prepare`.

It runs after the Validation Workspace is created and before checks.

Use it for dependency install, restore, sync, or fetch work needed by later validation phases.

Example:

```json
{
  "validation": {
    "prepare": {
      "command": "pnpm install --frozen-lockfile --prefer-offline",
      "timeoutSeconds": 1200
    }
  }
}
```

If `validation.prepare` is present, `command` is required.

The command must be a non-empty shell command string.

V1 supports one prepare command string.

V1 does not support prepare argv arrays or multiple prepare commands.

`timeoutSeconds` is optional and defaults to `1200` seconds.

`timeoutSeconds` must be a positive integer.

Prepare runs through the configured validation sandbox mode.

Prepare has no separate network policy.

Network access is controlled by the sandbox mode.

Prepare may modify files inside the Validation Workspace.

Later validation phases run against those workspace changes.

Prepare changes are not committed to the task branch and are not preserved as artifacts.

Missing `validation.prepare` records the prepare phase as skipped.

A failed or timed-out prepare creates a blocking Finding without severity and stops later validation phases.

Prepare artifacts use refs shaped like:

```text
artifact:<validation-run-id>/prepare/prepare/<filename>
```

Each prepare round captures these artifacts:

```text
stdout.txt
stderr.txt
exit-code.json
logs.txt
```

## Checks

Checks are repo-owned commands.

Repo config must define at least one check at `validation.checks`.

Top-level `checks` is not valid config.

Missing or empty `validation.checks` is a Submit Rejection Error before Validation Run creation.

But Why does not own the repo's CI logic.

V1 check commands are shell command strings.

Argv-array check commands are deferred until Sandcastle supports argv-native execution.

A repo can use any command it wants:

```text
just validate
pnpm check
make test
nx affected
./scripts/validate.sh
```

A check may set `timeoutSeconds`.

Check config does not support `severity` in v1.

`timeoutSeconds` must be a positive integer.

Checks without `timeoutSeconds` default to `1200` seconds.

A timed-out check creates a blocking Finding without severity, not a Validation Tooling Failure.

Later configured checks still run after a check failure or timeout.

A check `id` is the Producer id for that check's validation output.

Check ids must be valid Producer identifiers.

Check ids contain only lowercase letters, numbers, `-`, and `_`.

Check ids start with a lowercase letter or number.

Duplicate check ids are a Submit Rejection Error before Validation Run creation.

Check artifacts use opaque Artifact UUIDs with Run, Attempt, phase, Producer, and filename stored as provenance metadata.

Each check execution captures these artifacts:

```text
stdout.txt
stderr.txt
exit-code.json
logs.txt
```

Check artifacts are saved outside the Validation Workspace before workspace cleanup.

Check artifact capture uses the command result returned by Sandcastle, not files left in the Validation Workspace.

V1 checks run sequentially.

Every configured check runs after an ordinary failure or timeout so one Attempt collects the complete set of check Findings.

Every executed check records its result and Artifacts, whether it passes, fails, or times out.

Prepare failure, Validation Tooling Failure, workspace-integrity failure, Hold, or cancellation stops later checks because the Attempt is no longer trustworthy or active.

Check commands may modify the Validation Workspace, but those changes never modify the submitted branch.

A failed check creates a blocking Finding without severity.

Failed check Finding evidence includes the command and exit code, not stdout or stderr excerpts.

Timeout Findings omit severity.

Timeout Finding evidence includes the command and `timeoutSeconds`.

Failed and timed-out check Findings include stdout, stderr, exit-code, and logs artifact refs.

## Validation phases

V1 uses fixed phases, not a generic workflow language.

The phases are:

```text
preflight
prepare
checks
intent_review
quality_review
publish_pr
watch_pr
```

Config fills these phases.

Config should not allow arbitrary phase ordering in v1.

## Reviewer output

Reviewer output is JSON validated with Effect Schema.

Sandcastle handles structured output retry.
But Why validates the final output before storing Findings.
Reviewer output contains exactly one top-level field named `findings`.
Unknown fields are rejected.

Finding shape:

```text
title
description
severity: critical | high | medium | low
evidence
files
artifactRefs
```

Reviewer Findings must include `severity`.

Missing or invalid reviewer severity is a reviewer output contract failure.
Finding text fields must be non-empty.
Finding `files` entries must be repo-relative paths.
The `files` array may be empty when the reviewer cannot identify a specific file.
Finding `artifactRefs` entries use `artifact:<validation-run-id>/<phase>/<producer>/<filename>`.
The `artifactRefs` array may be empty when no stored artifact supports the Finding.
Schema decoding validates reference shape, while repository and artifact existence are checked later with the required runtime context.

Any Finding blocks that Candidate's Validation Run regardless of severity.
When automatic fixing is enabled, orchestration sends the complete phase-local Finding batch to a Fixer.
When no automatic fixing path is configured, But Why? code records Change-level Needs Input from the open Findings.
Agents never request Needs Input or change lifecycle state.

## Token accounting

V1 records tokens, not dollars.

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

Run and task totals sum each token bucket separately.

Runtime token usage payloads require `inputTokens` and `outputTokens` as non-negative integers.
Missing `cachedInputTokens` normalizes to `0`.
Missing `totalTokens` normalizes to `inputTokens + outputTokens`.
An absent token usage payload creates no Token Usage Record.

## Related docs

Development tooling is documented in `docs/tooling.md`.
