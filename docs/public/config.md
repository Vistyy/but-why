# But Why Config

This reference is for a user or agent configuring one But Why repository.
It answers which settings belong in tracked Repo Config, which settings belong in Global Config, and how validation uses them.
Use the globally installed `by` executable for every command in this reference.

## Config files

Repo Config lives at `.but-why/config.json`.
It contains tracked repository policy.

Global Config lives at `~/.config/but-why/config.json`.
It contains reusable Agent Profiles and user-level Agent Profile selections.

Both files are validated when But Why reads them.

Task Submit reads Repo Config from the exact captured Review Base.
Change Start directly reads Repo Config and repository reviewer instructions from the exact fetched starting Change Base.
It combines them with current Global Config and installed-package resources and stores one complete immutable Change policy.
Change Submit uses only that stored policy for Prepare, Checks, Agent Environment, Acceptance Review, and Specialist Reviews.
It does not reread policy from Change Base, the current checkout, Candidate Repo Config, current Repo Config, or later Global Config.
Global resource paths remain live operator-owned dependencies after selection.

## Repo Config

A complete example is:

```json
{
  "idPrefix": "BY",
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
  },
  "review": {
    "task": {
      "agentProfile": { "scope": "repo", "name": "strict-reviewer" },
      "instructionsFile": ".but-why/reviewers/task.md"
    },
    "acceptance": {
      "agentProfile": { "scope": "repo", "name": "strict-reviewer" }
    },
    "specialists": ["standards"]
  },
  "reviewers": {
    "standards": {
      "instructionsFile": ".but-why/reviewers/standards.md"
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

`idPrefix` is the repository's uppercase ID Prefix.
But Why freezes it in Shared Repository State and derives Task IDs as `<id-prefix>-<task-integer>` and Change IDs as `<id-prefix>-C<change-integer>`.
`agentEnvironment.command` is an optional non-empty argument list for headless reviewers.
`prepare` is an optional setup command.
`validation.checks` is a non-empty ordered list of Checks.
`review` selects Task Review policy, Acceptance Review policy, and Specialists.
`reviewers` supplies Specialist instruction files.
`agentProfiles` supplies Repo Agent Profiles.

But Why detects Git facts at runtime.
Repo Config does not define the default branch, publication remote, GitHub repository, or current head.

## Repository Preparation

When configured, top-level `prepare` runs in each new Managed Worktree and once before Validation Checks.
It contains a non-empty command and an optional positive `timeoutSeconds`.
The default timeout is 1200 seconds.
When `prepare` is absent, But Why runs no Repository Preparation.
Change Submit starts Checks without an empty Prepare phase.

Change Start runs Repository Preparation in the new Managed Worktree.
A failure preserves the Change and Managed Worktree, is recorded as the current preparation failure, and does not block implementation or Submission.
Task Submit runs it before reviewer execution in the exact Review Base workspace.
A Task Review preparation failure completes as tooling failed only after exact workspace cleanup succeeds.
Change Submit runs it before Checks in the Snapshot Workspace.
Retry it with:

```bash
by change prepare <change-id>
```

A Change Start or Change Prepare failure reports the command, exit or timeout facts, bounded stdout and stderr, and the retry command.
A successful retry clears the current preparation failure.
During Change Submit, a nonzero exit or timeout creates a Finding.
An execution or Candidate-integrity failure during Change Submit is a Validation Tooling Failure.
Both Change Submit outcomes prevent publication.

## Checks

`validation.checks` must contain at least one Check.
Each Check has a unique `id`, a non-empty shell `command`, and an optional positive `timeoutSeconds`.
The default Check timeout is 1200 seconds.

Every Check runs after Repository Preparation passes.
A non-zero exit or timeout creates a Finding and does not stop later Checks.
Execution or observation failure is a Validation Tooling Failure.
Any Check Finding stops reviewer phases for that Candidate.

## Task Review

Repo Config and Global Config may select `review.task.agentProfile` and `review.task.instructionsFile`.
The Agent Profile selection resolves from Repo Config, then Global Config, then `defaultAgentProfile`.
A Repo selection may reference a Repo or Global Agent Profile through its explicit scope.

Task Review uses at most one optional guidance file.
The Repo Config file takes precedence over the Global Config file.
Repo paths and Repo Agent Profile resources resolve from the exact captured Review Base workspace.
Global paths and Global Agent Profile resources resolve from the Global Config directory.
A missing, empty, or unreadable selected file rejects Task Submission before a Task Review is created.

The configured guidance supplements the mandatory built-in Task Review instructions, which remain controlling.
Task Submission resolves the Agent Profile configuration, mandatory instructions, optional guidance content, and guidance source before reviewer execution.
The Task stores that configuration with the Task Reviewer Agent Session when the first Agent Invocation links.
A Task Review that fails before any Invocation reports no executed reviewer configuration.
Later configuration changes do not alter the stored Task configuration after execution begins.
A failed launch retries with the same frozen policy.

## Review and Specialists

Acceptance Review is always enabled for Changes linked to a Task.
Its instructions resolve from Repo Config, then Global Config, then the prompt shipped with But Why.
Its Agent Profile resolves from Repo Config, then Global Config, then the Global default.

No Specialist is enabled by default.
Repo Config `review.specialists` replaces the Global list when present.
An empty Repo Config list disables inherited Specialists.

Each Specialist name resolves a definition from Repo Config before Global Config.
A definition requires `instructionsFile` and may select an Agent Profile.
Duplicate names and unresolved definitions reject Submission before a Validation Run starts.
Specialists execute in configured list order.

For a Change linked to a Task, But Why supplies the exact immutable Acceptance Context to each Specialist as an authoritative scope constraint.
The Specialist uses it only to constrain Findings and required corrections.
For a Change without a Task, But Why supplies no Acceptance Context block or explanation of its absence.
The same conditional behavior applies to initial and continuation Specialist prompts.
Each configured Specialist instruction file must positively define exactly one concern and state its applicable authority, review lenses, materiality, and concern-specific exclusions.
But Why's universal Specialist role boundaries, Acceptance Context handling, Candidate integrity rules, and output contract remain controlling.

## Agent Environment

Repo Config may define one `agentEnvironment.command` argument list.
Every entry must be a non-empty string.
But Why prepends the list to the complete Pi invocation for headless reviewers after it resolves the Agent Profile.

Interactive Sessions run Pi through the Herdr pane shell environment.
Change Implement does not read or apply `agentEnvironment.command`.
Change Start resolves the setting from the exact fetched starting Change Base and stores it in the immutable Change policy.
Acceptance and Specialist reviewer configuration remains Change-owned.
Validation Runs do not duplicate this policy.
Candidate configuration does not change this setting.
Missing configuration preserves direct reviewer launch.
An invalid configuration rejects the applicable headless reviewer operation before agent launch.
A configured wrapper failure stops the reviewer operation without an unwrapped retry.
The Agent Environment does not alter Repository Preparation or Checks.

## Global Config and Agent Profiles

### Global review settings

Global Config may define Task Review, Acceptance Review, and Specialist settings:

```json
{
  "review": {
    "task": {
      "agentProfile": { "scope": "global", "name": "reviewer" },
      "instructionsFile": "review/task.md"
    },
    "acceptance": {
      "agentProfile": { "scope": "global", "name": "reviewer" },
      "instructionsFile": "review/acceptance.md"
    },
    "specialists": ["standards"]
  },
  "reviewers": {
    "standards": {
      "instructionsFile": "review/standards.md",
      "agentProfile": { "scope": "global", "name": "reviewer" }
    }
  }
}
```

`review.task.agentProfile` selects the Global Task Review profile.
`review.task.instructionsFile` selects Global Task Review guidance relative to the Global Config directory.
`review.acceptance.agentProfile` selects the Global Acceptance Review profile.
`review.acceptance.instructionsFile` selects Global Acceptance Review instructions relative to the Global Config directory.
`review.specialists` is the ordered Global Specialist list.
`reviewers` maps Specialist names to definitions.
Each Global definition requires `instructionsFile` relative to the Global Config directory and may select an Agent Profile.
Each Agent Profile reference resolves only within its declared scope.
A `repo` reference must be defined in Repo Config, and a `global` reference must be defined in Global Config.
Global review settings may reference a Repo Config profile when that repository supplies the matching definition.

Global Config may define reusable profiles and role selections:

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
        "tools": ["read", "bash", "grep", "find", "ls"]
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

V1 supports only the `pi` runtime.
A profile stores `model`, `thinking`, `extensions`, `skills`, `tools`, and `contextFileDiscovery` under `runtimeConfig`.
Reviewer operations require `runtimeConfig.model`.

Selections use `{ "scope": "repo" | "global", "name": "..." }`.
An explicit selection resolves only the declared scope.
Change Start resolves Acceptance Review and Specialist profile selections from its Change Base Repo Config, then Global Config, then Global `defaultAgentProfile`.
In a published target repository, Interactive Session selection uses the Change Managed Worktree Repo Config, then Global Config, then Global `defaultAgentProfile`.

Configured resource arrays are exact allowlists for user-configured resources.
An empty array disables that user-configured resource type.
An omitted field preserves normal Pi behavior.
Trusted host resources required by But Why remain active independently of these arrays.
Repo reviewer instruction text is read directly from the starting Change Base and stored with the Change policy.
Repo Agent Profiles used for Task Review or Validation may use only package resource URIs for extensions and skills.
Candidate-relative and repository-relative reviewer extensions and skills are not supported.
Global relative paths resolve from the Global Config directory and remain live external dependencies.
Supported absolute paths and Pi package sources may be used by Global Profiles.

The old flat `agentModel` and `thinking` fields are invalid.
Non-Pi runtimes and unknown configuration keys are invalid.
No compatibility parser or automatic migration is provided.
