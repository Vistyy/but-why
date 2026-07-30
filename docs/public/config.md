# But Why Config

This reference is for a user or agent configuring one But Why repository.
It answers which settings belong in tracked Repo Config, which settings belong in Global Config, and how validation uses them.

## Config files

Repo Config lives at `.but-why/config.json`.
It contains tracked repository policy.

Global Config lives at `~/.config/but-why/config.json`.
It contains reusable Agent Profiles and user-level Agent Profile selections.

Both files are validated when But Why reads them.

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

`taskPrefix` is the repository's uppercase Task ID prefix.
`agentEnvironment.command` is an optional non-empty argument list for host-run Implementers and reviewers.
`prepare` is an optional setup command.
`validation.checks` is a non-empty ordered list of Checks.
`validationWorkspace.copyFiles` is an optional list of local regular files copied into each Validation Workspace.
`review` selects Acceptance Review and Specialists.
`reviewers` supplies Specialist instruction files.
`agentProfiles` supplies Repo Agent Profiles.

But Why detects Git facts at runtime.
Repo Config does not define the default branch, publication remote, GitHub repository, or current head.

## Repository Preparation

Top-level `prepare` runs in each new Managed Worktree and once before Validation Checks.
It contains a non-empty command and an optional positive `timeoutSeconds`.
The default timeout is 1200 seconds.

Change Start runs Repository Preparation before it reports a Change as ready.
Change Submit runs it before Checks in the Validation Workspace.
A failure preserves the Change and Managed Worktree.
Retry it with:

```bash
by change prepare <change-id>
```

A Repository Preparation failure reports the command, exit or timeout facts, bounded stdout and stderr, and the retry command.

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
Each path must identify an existing regular file.
Directories, symbolic links, non-regular files, missing paths, and paths outside the repository reject Submission.
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

## Agent Environment

Repo Config may define one `agentEnvironment.command` argument list.
Every entry must be a non-empty string.
But Why prepends the list to the complete Pi invocation after it resolves the Agent Profile.

Change Implement reads the setting from the Change Managed Worktree.
Change Submit records the setting in the Validation Policy Snapshot.
Missing configuration preserves direct Pi launch.
An invalid configuration rejects the applicable command before agent launch.
A configured wrapper failure stops the operation without an unwrapped retry.
The Agent Environment does not alter Repository Preparation or Checks.

## Global Config and Agent Profiles

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
Reviewer selection uses Repo Config, then Global Config, then Global `defaultAgentProfile`.
Interactive Session selection uses Repo Config, then Global Config, then Global `defaultAgentProfile`.

Configured resource arrays are exact allowlists.
An empty array disables that resource type.
An omitted field preserves normal Pi behavior.
Repo paths resolve from the Managed Worktree and remain inside the repository.
Global relative paths resolve from the Global Config directory.
Supported absolute paths and Pi package sources may be used by Global Profiles.

The old flat `agentModel` and `thinking` fields are invalid.
Non-Pi runtimes and unknown configuration keys are invalid.
No compatibility parser or automatic migration is provided.

For opt-in Change Implement continuation, add the packaged `extensions/continue-change.ts` extension to the Global `implementer` profile.
