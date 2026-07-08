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

Global config owns user defaults.

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
    }
  },
  "checks": [
    {
      "id": "quality",
      "command": "just quality",
      "timeoutSeconds": 1200
    }
  ],
  "review": {
    "intent": {
      "reviewer": "intent"
    },
    "quality": {
      "mode": "parallel",
      "reviewers": ["bugs", "simplicity", "domain", "docs"]
    }
  },
  "reviewers": {
    "intent": {
      "profile": "default",
      "instructionsFile": ".but-why/reviewers/intent.md"
    },
    "bugs": {
      "profile": "default",
      "instructionsFile": ".but-why/reviewers/bugs.md"
    }
  },
  "validationWorkspace": {
    "copyFiles": [".env.test", "config/local-validation.json"]
  },
  "ignorePatterns": [
    "*.generated.ts",
    "vendor/**"
  ]
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
  "agentProfiles": {
    "default": {
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

Profile lookup order is:

```text
reviewer inline setting
  -> repo agent profile
  -> global agent profile
  -> error
```

## Validation workspace

Repo config may allowlist untracked files to copy into the validation workspace.

These paths are repo-relative.

They are copied into the Sandcastle worktree before validation commands or reviewers run.

Example:

```json
{
  "validationWorkspace": {
    "copyFiles": [".env.test", "config/local-validation.json"]
  }
}
```

V1 should not copy untracked files automatically.

Missing allowlisted files should be structured tooling errors.

Copied files are not part of the submitted commit SHA.

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

Repo config must define at least one check.

Missing or empty `checks` is a Submit Rejection Error before Validation Run creation.

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

Validation stops immediately after a check timeout.

A check `id` is the Producer id for that check's validation output.

Check ids must be valid for artifact refs.

Check ids contain only lowercase letters, numbers, `-`, and `_`.

Check ids start with a lowercase letter or number.

Duplicate check ids are a Submit Rejection Error before Validation Run creation.

Check artifacts use refs shaped like:

```text
artifact:<validation-run-id>/checks/<check-id>/<filename>
```

Each check round captures these artifacts:

```text
stdout.txt
stderr.txt
exit-code.json
logs.txt
```

Check artifacts are saved outside the Validation Workspace before workspace cleanup.

Check artifact capture uses the command result returned by Sandcastle, not files left in the Validation Workspace.

V1 checks run sequentially.

V1 stops on the first failed check.

Every executed check records a round and artifacts, whether it passes, fails, or times out.

Checks skipped after an earlier failure or timeout do not record rounds or artifacts.

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

Sandcastle should handle structured output retry.

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

Any Finding blocks v1 validation and moves the Task to `needs_input`, regardless of severity.

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

## Related docs

Development tooling is documented in `docs/tooling.md`.
