# Configuration

This document describes the intended v1 configuration model.

But Why? is not implemented yet.

These examples describe the planned shape.

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

## Foundation tooling

The repository foundation uses ESM TypeScript on Node.js 24.x.

Nix provides the blessed reproducible development environment.

Nix is optional for development.

A non-Nix environment may run the project if it provides Node.js 24.x, pnpm, Just, and installed project dependencies.

Corepack is not part of the repo toolchain.

Agents should use Just recipes instead of invoking pnpm directly.

The project uses Vitest for tests.

Biome handles formatting and linting.

The TypeScript compiler runs strict typechecking with `tsc --noEmit`.

SQLite access uses `node:sqlite`.

CLI output is converted to TOON-style text only at the stdout boundary.

Internal command logic uses typed JSON-like objects.

## Agent-facing Just recipes

The stable recipes are:

```sh
just quality
just lint
just typecheck
just test
just format
just format-check
just by [args]
```

`just quality` runs format checks, linting, typechecking, and tests.

`just quality` must not modify files.

`just format` may modify files.

`just format-check` must not modify files.

`just by [args]` runs the repo-local `by` CLI.
