# But Why config

Repo config lives at `.but-why/config.json` and is tracked repo policy.
Global config lives at `~/.config/but-why/config.json` and owns reusable Agent Profiles plus the Default Agent Profile selection.

## Minimal validation config

```json
{
  "taskPrefix": "BY",
  "validation": {
    "sandbox": { "mode": "none" },
    "prepare": {
      "command": "pnpm install --frozen-lockfile --prefer-offline",
      "timeoutSeconds": 1200
    },
    "checks": [
      { "id": "quality", "command": "just quality", "timeoutSeconds": 1200 }
    ],
    "automaticFixing": true
  }
}
```

## Post-init flow

1. Inspect repository tooling before choosing commands.
2. Put dependency install, restore, sync, or fetch work in `validation.prepare` when needed.
3. Put verification commands in `validation.checks`.
4. Commit `.but-why/config.json` so reviewers can inspect the policy.

## `validation.prepare`

`validation.prepare` is optional and runs before checks inside the Validation Workspace.
Its `command` is required when the section is present.
`timeoutSeconds` is optional and defaults to 1200.

## `validation.checks`

`validation.checks` is required for submit and must contain at least one check.
`validation.automaticFixing` defaults to `true`.
Manual `by submit` supports `--no-auto-fix` and `--auto-fix-command <command>` overrides.
AFK work follows Repo Config and ignores manual overrides.
Top-level `checks` is not valid config.
Each check needs an `id` and `command`.
Check IDs use lowercase letters, numbers, `-`, and `_`.
`timeoutSeconds` is optional and defaults to 1200.

## Agent Profiles

Supported `agentRuntime` values are `pi`, `claude-code`, `codex`, `cursor`, `opencode`, and `copilot`.
An Agent Profile keeps `agentRuntime`, optional `agentModel`, and optional `thinking` together.
All current adapters require `agentModel` when an agent operation resolves the profile.
For Pi, `thinking` is `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
Other runtimes accept a non-empty runtime-defined value.

Global config selects its default by name:

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

A reviewer may explicitly select a profile:

```json
{
  "taskPrefix": "BY",
  "validation": {
    "checks": [{ "id": "quality", "command": "just quality" }]
  },
  "review": {
    "intent": { "reviewer": "intent" }
  },
  "reviewers": {
    "intent": {
      "agentProfile": "strict-reviewer",
      "instructionsFile": ".but-why/reviewers/intent.md"
    }
  },
  "agentProfiles": {
    "strict-reviewer": {
      "agentRuntime": "pi",
      "agentModel": "anthropic/claude-sonnet-4",
      "thinking": "high"
    }
  }
}
```

An explicit `agentProfile` resolves Repo Config first, then Global Config.
A reviewer without `agentProfile` uses `defaultAgentProfile` and resolves that profile from Global Config only.
Profiles are validated when an operation needs to run an agent, so unrelated commands remain usable.
Unsupported runtimes, missing profiles, and required missing models produce typed errors with setup actions.
A harness launch failure is reported when But Why first attempts to use the harness.

Config rejects unknown keys, including `ignorePatterns`.
