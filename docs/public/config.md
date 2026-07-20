# But Why Config

## Config files

Repo Config lives at `.but-why/config.json` and contains tracked repository policy.
Global Config lives at `~/.config/but-why/config.json` and contains reusable Agent Profiles and the Default Agent Profile selection.

## Example Repo Config

Replace the example commands with commands from the repository's tooling.
Top-level `prepare` is optional.
`validation.checks` is required for Submission and must contain at least one check.

```json
{
  "taskPrefix": "BY",
  "prepare": {
    "command": "pnpm install --frozen-lockfile --prefer-offline",
    "timeoutSeconds": 1200
  },
  "validation": {
    "sandbox": { "mode": "none" },
    "checks": [
      { "id": "quality", "command": "just quality", "timeoutSeconds": 1200 }
    ]
  }
}
```

After `by init`:

1. Inspect the repository tooling.
2. Put dependency installation, restore, sync, or fetch work in top-level `prepare` when required.
3. Put verification commands in `validation.checks`.
4. Commit `.but-why/config.json` so reviewers can inspect the policy.

## `prepare`

Top-level `prepare` runs in new Managed Worktrees and before Checks in Validation Workspaces.
When `prepare` is present, it must contain `command`.
`timeoutSeconds` is optional and defaults to 1200.

## `validation.checks`

`validation.checks` must contain at least one Check before Submission.
Top-level `checks` is invalid.
Each Check must contain an `id` and a `command`.
Check IDs may contain lowercase letters, numbers, `-`, and `_`.
`timeoutSeconds` is optional and defaults to 1200.

## Agent Profiles

Supported `agentRuntime` values:

- `pi`
- `claude-code`
- `codex`
- `cursor`
- `opencode`
- `copilot`

An Agent Profile contains `agentRuntime`, optional `agentModel`, and optional `thinking`.
All current adapters require `agentModel` when an agent operation resolves the profile.

For Pi, `thinking` must be `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
Other runtimes accept a non-empty runtime-defined value.

Global Config selects the Default Agent Profile by name:

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

A reviewer may select an Agent Profile explicitly:

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

When a reviewer names an `agentProfile`, But Why searches Repo Config first and Global Config second.
When a reviewer does not name an `agentProfile`, But Why uses `defaultAgentProfile` and searches Global Config only.
But Why validates profiles when an operation needs an agent, so unrelated commands remain available.
Unsupported runtimes, missing profiles, and missing required models produce typed errors with setup actions.
But Why reports a harness launch failure when it first tries to use the harness.

Use only documented keys.
Config rejects unknown keys; `ignorePatterns` is not supported.
