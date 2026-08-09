# But Why Config

This reference is for a user or agent configuring one But Why repository.
It answers which settings belong in tracked Repo Config, which settings belong in Global Config, and how validation uses them.

## Config files

Repo Config lives at `.but-why/config.json`.
It contains tracked repository policy.

Global Config lives at `~/.config/but-why/config.json`.
It contains reusable Agent Profiles and user-level Agent Profile selections.

Both files are validated when But Why reads them.

Change Submit reads the Repo Config from the exact fetched Change Base as the non-review policy baseline, captures a Candidate, then reads the Candidate's tracked Repo Config for reviewer policy and Repo Agent Profiles.
The caller checkout is used only for Local Repository identity, Shared Repository State, and Change selection, so its Repo Config does not supply submission policy.
Global Config remains resolved from the configured user path.

## Repo Config

A complete example is:

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
  },
  "validationWorkspace": {
    "copyFiles": [".env.test"]
  },
  "review": {
    "acceptance": {
      "agentProfile": { "scope": "repo", "name": "strict-reviewer" }
    },
    "specialists": ["standards"],
    "task": {
      "agentProfile": { "scope": "repo", "name": "strict-reviewer" },
      "instructionsFile": ".but-why/reviewers/task-review.md"
    }
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

`taskPrefix` is the repository's uppercase Task ID prefix.
`agentEnvironment.command` is an optional non-empty argument list for headless reviewers.
`prepare` is an optional setup command.
`validation.checks` is a non-empty ordered list of Checks.
`validationWorkspace.copyFiles` is an optional list of local regular files copied into each Validation Workspace.
`review` selects Acceptance Review, Specialists, and the Task Reviewer.
`review.task.agentProfile` selects the Task Reviewer Agent Profile, resolved Repo Config before Global Config, then Global `defaultAgentProfile`.
`review.task.instructionsFile` supplies an optional repo-local Task Reviewer instruction file.
`reviewers` maps Specialist names to definitions; it never supplies Task Reviewer instructions.
Each configured Specialist instruction file must positively define exactly one concern.
It must state the concern's applicable authority, review lenses, materiality, and concern-specific exclusions.
It must not duplicate or override But Why's universal Specialist role boundaries, Acceptance Context handling, Candidate integrity rules, or output contract.
`agentProfiles` supplies Repo Agent Profiles.

Change Implement sessions always load the packaged `continue-change` extension once.

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
Change Submit runs it before Checks in the Validation Workspace.
Retry it with:

```bash
by change prepare <change-id>
```

A Change Start or `by change prepare` failure reports the command, exit or timeout facts, bounded stdout and stderr, and the retry command.
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

## Copied local files

`validationWorkspace.copyFiles` is optional.
When present, it must be a non-empty list of normalized paths relative to the Local Repository's main checkout.
The Repo Config schema rejects paths that are not repo-relative or that use parent traversal.
During Validation Workspace setup, each path must identify an existing regular file.
A missing path, directory, symbolic link, or other non-regular path creates a Validation Tooling Failure.
Change Submit reports `validation_tooling_failed`; fix the path or the validation tooling, then retry Change Submit.
Duplicate entries are accepted but do not identify additional files.

But Why copies each file once into the Validation Workspace.
Copied files are local environment inputs, not Candidate content.
Their contents are not hashed, stored, or exposed through Findings.
But Why removes them with the temporary workspace.

## Review and Specialists

Acceptance Review is always enabled for Task-backed Changes.
Its instructions resolve from Repo Config, then Global Config, then the prompt shipped with But Why.
Its Agent Profile resolves from Repo Config, then Global Config, then the Global default.

No Specialist is enabled by default.
Repo Config `review.specialists` replaces the Global list when present.
An empty Repo Config list disables inherited Specialists.

Each Specialist name resolves a definition from Repo Config before Global Config.
A definition requires `instructionsFile` and may select an Agent Profile.
Duplicate names and unresolved definitions reject Submission before a Validation Run starts.
Specialists execute in configured list order.

For a Task-backed Change, But Why supplies the exact immutable Acceptance Context to each Specialist as an authoritative scope constraint.
The Specialist uses it only to constrain Findings and required corrections.
For a taskless Change, But Why supplies no Acceptance Context block or explanation of its absence.
The same conditional behavior applies to initial and continuation Specialist prompts.
Configured instructions define the concern, but cannot override these common boundaries.

## Task Review

Task Submission runs one Task Reviewer for an unlinked New Task.
Its Agent Profile resolves from Repo Config `review.task.agentProfile`, then Global Config, then Global `defaultAgentProfile`.
Submission fails when no profile resolves; there is no built-in Task Reviewer Agent Profile.
Its instructions resolve from Repo Config `review.task.instructionsFile`, then Global Config, then the built-in Task Reviewer instructions.
The built-in instructions require the strict Task Dependency definition and complete Task Verification Contract rules.
Task Submission resolves the Task Reviewer policy from the Repo Config at the canonical-main-checkout `HEAD` commit.
Configured Repository Preparation runs in the disposable Task Review workspace; automatic Validation Checks do not run.

## Agent Environment

Repo Config may define one `agentEnvironment.command` argument list.
Every entry must be a non-empty string.
But Why prepends the list to the complete Pi invocation for headless reviewers after it resolves the Agent Profile.

Interactive Sessions run Pi through the Herdr pane shell environment.
Change Implement does not read or apply `agentEnvironment.command`.
Change Submit resolves the setting from the exact fetched Change Base Repo Config and records it in the Validation Policy Snapshot for headless reviewers.
Candidate reviewer configuration does not change this setting.
Missing configuration preserves direct reviewer launch.
An invalid configuration rejects the applicable headless reviewer operation before agent launch.
A configured wrapper failure stops the reviewer operation without an unwrapped retry.
The Agent Environment does not alter Repository Preparation or Checks.

## Global Config and Agent Profiles

Global review settings

Global Config may define Acceptance Review and Specialist settings:

```json
{
  "review": {
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

`review.acceptance.agentProfile` selects the Global Acceptance Review profile.
`review.acceptance.instructionsFile` selects Global Acceptance Review instructions relative to the Global Config directory.
`review.specialists` is the ordered Global Specialist list.
A Repo Config Specialist list replaces this list, and an empty Repo Config list disables inherited Specialists.
`reviewers` maps Specialist names to definitions.
Each Global definition requires `instructionsFile` relative to the Global Config directory and may select an Agent Profile.
A Repo Config definition takes precedence for a Specialist with the same name.
Each Agent Profile reference resolves only within its declared scope.
A `repo` reference must be defined in Repo Config, and a `global` reference must be defined in Global Config.
Global review settings may reference a Repo Config profile when that repository supplies the matching definition.
Reviewer and Specialist profile selections resolve from Repo Config, then Global Config, then Global `defaultAgentProfile`.

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
Reviewer and Specialist profile selections resolve from the Candidate Repo Config, then Global Config, then Global `defaultAgentProfile`.
Interactive Session selection uses the Change Managed Worktree Repo Config, then Global Config, then Global `defaultAgentProfile`.

Configured resource arrays are exact allowlists.
An empty array disables that resource type.
An omitted field preserves normal Pi behavior.
Repo paths resolve from the Candidate Validation Workspace and remain inside the repository.
Global relative paths resolve from the Global Config directory.
Supported absolute paths and Pi package sources may be used by Global Profiles.

The old flat `agentModel` and `thinking` fields are invalid.
Non-Pi runtimes and unknown configuration keys are invalid.
No compatibility parser or automatic migration is provided.

Change Implement sessions automatically load the packaged `continue-change` extension. Agent Profile extension settings continue to control only user-configured extensions.
