# But Why Config

But Why uses two configuration files.

Repo Config lives at `.but-why/config.json` and contains tracked repository policy.

Global Config lives at `~/.config/but-why/config.json` and contains reusable Agent Profiles, the Default Agent Profile selection, and the optional Interactive Session Agent Profile selection.

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

## Repository Preparation

Top-level `prepare` runs in new Managed Worktrees and before Checks in Validation Workspaces.

The same command and timeout apply to both workspace types.

When `prepare` is present, it must contain `command`.

`timeoutSeconds` is optional and defaults to 1200.

Change Start runs this command before it reports a Change as ready.

Change Submit runs it before Checks in the Validation Workspace.

The explicit retry command is:

```text
by change prepare <change-id>
```

For a programmatic caller:

```bash
by change prepare <change-id> --output json
```

A successful result reports the Change as ready and includes its Managed Worktree path:

```text
change:
  id: chg_01J...
  taskId: null
  readiness: ready
worktreePath: /path/to/repository-worktrees/but-why/change-chg_01J...
```

A failed result preserves the Change and worktree.

The JSON error contains `code: "prepare_failed"`, the Change ID, `readiness: "prepare_failed"`, the worktree path, the command, exit or timeout facts, and bounded stdout and stderr evidence:

```json
{
  "error": {
    "code": "prepare_failed",
    "message": "Repository Preparation failed; the Change and worktree were preserved.",
    "changeId": "chg_01J...",
    "readiness": "prepare_failed",
    "worktreePath": "/path/to/repository-worktrees/but-why/change-chg_01J...",
    "command": "pnpm install --frozen-lockfile",
    "exitCode": 1,
    "timedOut": false,
    "stdout": "",
    "stderr": "lockfile is out of date"
  },
  "help": [
    "Fix the preparation failure, then run `by change prepare chg_01J...`."
  ]
}
```

Fix the configured command or its environment, then rerun `by change prepare <change-id>`.

A Change Implement launch is allowed only after preparation succeeds.

## `validation.checks`

`validation.checks` must contain at least one Check before Submission.

Top-level `checks` is invalid.

Each Check must contain an `id` and a `command`.

Check IDs may contain lowercase letters, numbers, `-`, and `_`.

`timeoutSeconds` is optional and defaults to 1200.

## Manual workflow commands

Task commands manage intent, approval, context, and dependencies.

Change commands manage implementation, validation, delivery, and reconciliation.

Human-facing examples omit `--output` and therefore use the default TOON output.

Programmatic callers request JSON explicitly.

Task-backed Change Start:

```bash
by change start --task <task-id> --output json
```

Taskless Change Start:

```bash
by change start --output json
```

A Task-backed Change captures Acceptance Context and later runs Acceptance Review.

A taskless Change has no Acceptance Context and omits Acceptance Review while retaining code-based validation and publication.

Use the recorded `worktreePath` for manual implementation, then submit the committed Candidate:

```bash
by change submit <change-id> --output json
```

Repeat Change Submit after fixing Findings in the Managed Worktree and committing the fixes.

When the owned pull request is ready, stop for human merge.

But Why does not merge it.

After the human merge, observe it with:

```bash
by change reconcile <change-id> --output json
```

The installed command templates are:

```text
by task create --title <title> --description-file <file> [--depends-on <task-id>]...
by task dependencies set <task-id> [--depends-on <task-id>]...
by task list [--all] [--state <state>]
by task show <task-id>
by task approve <task-id>
by task context <task-id>
by task context draft <task-id>
by task context apply <task-id>
by task comment <task-id> --file <file>
by task cancel <task-id> --reason <reason>
by change start [--task <task-id>]
by change prepare <change-id>
by change list [--all]
by change show <change-id>
by change findings <change-id>
by change validation-runs <change-id>
by change submit <change-id>
by change cancel <change-id>
by change reconcile [<change-id>]
by change implement <change-id> [--handoff-file <path>]
```

All command groups support these global output and help flags:

```text
--output <format>
-o <format>
--help
```

`--output` accepts `toon` or `json`.

TOON is the default.

## Agent Profiles

Supported `agentRuntime` values:

- `pi`
- `claude-code`
- `codex`
- `cursor`
- `opencode`
- `copilot`

An Agent Profile contains `agentRuntime`, optional `agentModel`, and optional `thinking`.

Reviewer adapters require `agentModel` when a reviewer operation resolves the profile.
The Interactive Session Agent Profile may omit `agentModel` or `thinking`; Pi supplies the omitted defaults.

For Pi, `thinking` must be `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.

Other runtimes accept a non-empty runtime-defined value.

Global Config selects the Default Agent Profile by name:

```json
{
  "defaultAgentProfile": "pi",
  "interactiveSession": {
    "agentProfile": "implementation"
  },
  "agentProfiles": {
    "pi": {
      "agentRuntime": "pi",
      "agentModel": "openai-codex/gpt-5.5",
      "thinking": "medium"
    },
    "implementation": {
      "agentRuntime": "pi",
      "agentModel": "openai-codex/gpt-5.6-luna",
      "thinking": "high"
    }
  }
}
```

The optional `interactiveSession.agentProfile` selects the Global Agent Profile for `by change implement`.
The selected profile must exist in Global Config and must use the Pi runtime.
Repo Config cannot select or override this profile.
But Why passes each selected `agentModel` and `thinking` value explicitly to Pi.
If `interactiveSession.agentProfile` is absent, Pi uses its normal model and thinking defaults.
A missing or non-Pi selection rejects Change Implement before Herdr launches and preserves the Change.

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

Config rejects unknown keys.

`ignorePatterns` is not supported.
