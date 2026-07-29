# But Why Config

But Why uses two configuration files.

Repo Config lives at `.but-why/config.json` and contains tracked repository policy.

Global Config lives at `~/.config/but-why/config.json` and contains reusable Agent Profiles and user-level Agent Profile selections.

## Example Repo Config

Replace the example commands with commands from the repository's tooling.

Top-level `prepare` is optional.

`validation.checks` is required for Submission and must contain at least one check.

```json
{
  "taskPrefix": "BY",
  "agentEnvironment": {
    "command": ["nix", "develop", "-c"]
  },
  "prepare": {
    "command": "pnpm install --frozen-lockfile --prefer-offline",
    "timeoutSeconds": 1200
  },
  "validation": {
    "checks": [
      { "id": "quality", "command": "just quality", "timeoutSeconds": 1200 }
    ]
  }
}
```

`agentEnvironment.command` is an optional non-empty argument list.

Each entry must be a non-empty string.

But Why prepends this command to the complete Pi invocation for the Implementer's Interactive Session and for every host-run reviewer.

Change Implement and Change Submit resolve the setting from the Change Managed Worktree, not the caller checkout.

Missing configuration preserves direct Pi launch.

An invalid configuration rejects the applicable command before agent launch and preserves the ready Change.

A configured wrapper failure stops the agent operation.

But Why never retries without the configured wrapper.

The wrapper applies to every host-run reviewer.

The wrapper does not alter Repository Preparation or Checks.

See [Agent-Assisted Setup and Manual Change Workflow](setup.md#configure-the-repository) for the canonical `by init` setup sequence, including `.sandcastle/**` exclusions for recursive repository tools.

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

## Host Validation Workspace

V1 runs Repository Preparation, Checks, reviewers, Candidate integrity verification, and cleanup through the host-only Validation Workspace path.
Sandcastle provides the internal disposable workspace and host process adapter.

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

Add `--base <branch>` to either form to select a named branch on the detected publication remote.
Without `--base`, Change Start selects the remote default branch.
Change Start fetches the selected branch and records its remote-tracking ref as the Change Base.
Local branches are not supported as Change Bases.

A Task-backed Change captures Acceptance Context and later runs Acceptance Review.

A taskless Change has no Acceptance Context and omits Acceptance Review while retaining code-based validation and publication.

Use the recorded `worktreePath` for manual implementation, then submit the committed Candidate:

```bash
by change submit <change-id> --output json
```

Change Submit reconciles an existing owned pull request before a new Submission.
A new Submission fetches the recorded remote Change Base before Candidate capture.
The Repository Branch must contain the exact fetched Change Base commit.
If it does not, merge or rebase the Change Base into the Repository Branch and retry.
The fetch and rejection do not modify the Managed Worktree or Repository Branch.
A Candidate is identified by the Change, `changeBaseSha`, and `headSha`.
A new Change Base commit creates a different Candidate and prevents evidence reuse by `headSha` alone.
Completed Submission evidence remains stable when the Change Base or configuration later changes.

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
by change start [--task <task-id>] [--base <branch>]
by change prepare <change-id>
by change list [--all]
by change show <change-id>
by change findings <change-id>
by change validation-runs <change-id>
by validation-run show <validation-run-id>
by validation-run artifact <validation-run-id> <artifact-ref>
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

Inspection commands use decision-oriented default schemas.
`by task show` omits the description and reports the exact `by task context <task-id>` expansion command.
`by change show` reports compact current Validation Run state and Finding and tooling-failure counts.
`by change validation-runs` reports complete compact history with counts and the Validation Run detail-command pattern.
`by validation-run show` retains the immutable policy and evidence.
It includes Artifact previews only when a Finding references them or the Validation Run has a tooling failure.

## Agent Profiles

V1 supports only the `pi` Agent Profile runtime.

Every profile stores Pi settings under `runtimeConfig`:

- `model`.
- `thinking`.
- `extensions`.
- `skills`.
- `tools`.
- `contextFileDiscovery`.

Reviewer operations require `runtimeConfig.model`.
Interactive Sessions may omit the model and preserve Pi's normal model behavior.

Profile selections use an explicit reference:

```json
{ "scope": "repo", "name": "implementer" }
```

Repo Config may declare Repo Agent Profiles and select the Interactive Session profile.
Global Config may declare Global Agent Profiles and select the fallback Interactive Session profile.
Global Config owns `defaultAgentProfile`.
The default profile is used when neither role selection exists.
An explicit reference resolves only the profile in its declared scope.
Duplicate names across scopes are valid.

Configured resource arrays are exact allowlists.
An empty array disables that resource type.
An omitted resource field preserves normal Pi behavior.
Repo extension and skill paths resolve from the Managed Worktree and remain inside the repository.
Global relative paths resolve from the Global Config directory.
Global profiles may also use supported absolute paths and Pi package sources.

Example Global Config:

```json
{
  "defaultAgentProfile": { "scope": "global", "name": "reviewer" },
  "interactiveSession": {
    "agentProfile": { "scope": "global", "name": "implementer" }
  },
  "agentProfiles": {
    "reviewer": {
      "agentRuntime": "pi",
      "runtimeConfig": {
        "model": "openai-codex/gpt-5.5",
        "thinking": "medium",
        "extensions": ["~/.pi/agent/extensions/package-manager-policy"],
        "skills": ["~/.pi/agent/skills/codebase-design"],
        "tools": ["read", "bash", "grep", "find", "ls", "web_search", "web_fetch", "web_content_get"]
      }
    },
    "implementer": {
      "agentRuntime": "pi",
      "runtimeConfig": {
        "model": "openai-codex/gpt-5.5",
        "thinking": "medium",
        "extensions": [
          "~/.pi/agent/extensions/inline-skills",
          "~/.pi/agent/extensions/openai-remote-compaction",
          "~/.pi/agent/extensions/package-manager-policy",
          "~/.pi/agent/extensions/web-search",
          "~/.pi/agent/extensions/herdr-agent-state.ts",
          "~/.pi/agent/extensions/openai-fast.ts",
          "~/.pi/agent/extensions/output-style.ts",
          "~/.pi/agent/extensions/statusline.ts",
          "~/.pi/agent/extensions/fuzzy-files/",
          "~/.pi/agent/extensions/codex-usage.ts",
          "~/.pi/agent/extensions/codex-resets.ts",
          "npm:@ogulcancelik/pi-auto-permissions@0.1.2"
        ]
      }
    }
  }
}
```

The Implementer profile does not configure `skills`, `tools`, or `contextFileDiscovery`.
Pi therefore keeps normal behavior for those resources.
The Implementer extension allowlist excludes subagent, Lavish, and session-recall extensions.

Reviewer profile selections use the same scoped reference contract:

```json
{
  "review": {
    "acceptance": {
      "agentProfile": { "scope": "repo", "name": "strict-reviewer" }
    }
  },
  "agentProfiles": {
    "strict-reviewer": {
      "agentRuntime": "pi",
      "runtimeConfig": {
        "model": "anthropic/claude-sonnet-4",
        "thinking": "high"
      }
    }
  }
}
```

Reviewer selection resolves the Repo role selection first, the Global role selection second, and the Global default last.
The resolved profile name and scope appear in validation policy and inspection output.

The old flat `agentModel` and flat `thinking` fields are invalid.
Non-Pi runtimes are invalid.
Configuration with an unknown key is invalid.
No compatibility parser or automatic migration is provided.

`ignorePatterns` is not supported.

For opt-in Change Implement continuation, add the packaged `extensions/continue-change.ts` extension to the Global `implementer` profile only.
