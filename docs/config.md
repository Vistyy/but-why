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
  "checks": [
    {
      "id": "validate",
      "command": "just validate",
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

## Checks

Checks are repo-owned commands.

But Why does not own the repo's CI logic.

A repo can use any command it wants:

```text
just validate
pnpm check
make test
nx affected
./scripts/validate.sh
```

V1 checks run sequentially.

V1 stops on the first failed check.

A failed check creates a blocking finding.

## Validation phases

V1 uses fixed phases, not a generic workflow language.

The planned phases are:

```text
preflight
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

Any finding blocks v1 validation and moves the task to `needs_input`.

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
