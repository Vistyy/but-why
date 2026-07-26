# Configuration

This document specifies the implemented Change-centered v1 configuration.
Use `by change submit <change-id>` to apply this validation policy to a Change Candidate.

## Config files

Repo Config lives at:

```text
.but-why/config.json
```

Global Config lives at:

```text
~/.config/but-why/config.json
```

Repo Config owns repository validation policy.
Global Config owns reusable local Agent Profiles, reviewer defaults, and optional interactive-session preferences.
Both files are validated at their read boundaries.

## Repo Config

Example:

```json
{
  "taskPrefix": "BY",
  "prepare": {
    "command": "pnpm install --frozen-lockfile",
    "timeoutSeconds": 1200
  },
  "validation": {
    "sandbox": {
      "mode": "none"
    },
    "checks": [
      {
        "id": "quality",
        "command": "just quality",
        "timeoutSeconds": 1200
      }
    ]
  },
  "validationWorkspace": {
    "copyFiles": [".env.test", "config/test-credentials.json"]
  },
  "review": {
    "acceptance": {
      "agentProfile": "strict"
    },
    "specialists": ["security"]
  },
  "reviewers": {
    "security": {
      "instructionsFile": ".but-why/reviewers/security.md"
    }
  },
  "agentProfiles": {
    "strict": {
      "agentRuntime": "pi",
      "agentModel": "anthropic/claude-sonnet-4",
      "thinking": "high"
    }
  }
}
```

Repo Config does not duplicate Git facts such as default branch, publication remote, GitHub repository, or current head.
But Why detects the publication remote at runtime.
Change Start fetches its default branch or the named `--base` branch.
For a new Submission, Change Submit fetches the recorded remote Change Base before Candidate capture.
Change Submit rejects the Submission unless the Repository Branch contains the exact fetched Change Base commit.
Completed Submissions retain their Validation Policy Snapshot and do not resolve later configuration changes.
Future or unfinished Submissions resolve current Repo Config and Global Config.

## Global Config

Example:

```json
{
  "defaultAgentProfile": "pi",
  "interactiveSession": {
    "agentProfile": "pi"
  },
  "agentProfiles": {
    "pi": {
      "agentRuntime": "pi",
      "agentModel": "openai-codex/gpt-5.5",
      "thinking": "medium"
    }
  },
  "review": {
    "acceptance": {
      "instructionsFile": "reviewers/acceptance.md"
    },
    "specialists": ["standards"]
  },
  "reviewers": {
    "standards": {
      "instructionsFile": "reviewers/standards.md"
    }
  }
}
```

Instruction paths in Global Config are relative to the Global Config directory.
Instruction paths in Repo Config are relative to the repository root.

Herdr must be installed and running when `by change implement` is invoked.

## Interactive Session Agent Profile

Global Config may set `interactiveSession.agentProfile` to a Global Agent Profile that uses Pi.
Repo Config cannot select or override this profile.
Change Implement passes configured `agentModel` and `thinking` values to Pi.
If the setting is absent, Change Implement preserves the existing Pi launch behavior.
A missing or non-Pi profile rejects Change Implement before Herdr launches and preserves the Change.

## Agent Profiles

An Agent Profile selects an `agentRuntime` and may select `agentModel` and `thinking`.
Reviewer operations require `agentModel`.

A role with an explicit `agentProfile` resolves Repo Config profiles before Global Config profiles.
A role without an explicit profile uses `defaultAgentProfile`, which resolves from Global Config only.
Profile validation is lazy so unrelated commands remain usable when an unused profile is invalid.

## Reviewer Pi resources

Acceptance Review and Specialist Review use the same fixed curated Pi resource wrapper.

The wrapper:

- The wrapper disables extension, skill, prompt template, and theme discovery.
- The wrapper loads `package-manager-policy` and `web-search` from `~/.pi/agent/extensions/`.
- The wrapper loads `codebase-design` from `~/.pi/agent/skills/`.
- The wrapper keeps `AGENTS.md` and `CLAUDE.md` context discovery enabled.
- The wrapper allows exactly `read`, `bash`, `grep`, `find`, `ls`, `web_search`, `web_fetch`, and `web_content_get`.

The `package-manager-policy` extension adds no tools and continues to enforce its bash policy hooks.
Docker and Podman Validation Workspaces mount the fixed reviewer resource paths and available global context files read-only at the corresponding Pi paths.
The wrapper is a But Why-owned reviewer default.
It is not Agent Environment configuration and it is not configurable through Repo Config or Global Config.
Agent Profiles continue to select reviewer model and thinking values only.

## Acceptance Review

Acceptance is always enabled for Task-backed submission.
Its instructions resolve in this order:

1. Repo Config `review.acceptance.instructionsFile`.
2. Global Config `review.acceptance.instructionsFile`.
3. The prompt shipped with But Why?.

Its profile resolves in this order:

1. Repo Config `review.acceptance.agentProfile`.
2. Global Config `review.acceptance.agentProfile`.
3. Global `defaultAgentProfile`.

Acceptance cannot be disabled.

## Specialists

No Specialist is enabled by But Why? by default.

When Repo Config contains `review.specialists`, that complete list is active.
Otherwise the Global Config list is active.
An empty Repo Config list disables inherited Specialists for that repository.

Each Specialist name resolves a definition from Repo Config before Global Config.
A Specialist definition requires `instructionsFile` and may select `agentProfile`.
Duplicate names and unresolved definitions reject submission before a Validation Run is created.
Specialist output is reported in configured list order.
Execution scheduling is internal and is not configurable in v1.

## Validation sandbox

Repo Config selects `validation.sandbox.mode`:

```text
none
docker
podman
```

Missing mode defaults to `none`.
An invalid mode rejects submission before Run creation.
An unavailable requested provider creates a Validation Tooling Failure.
Validation commands run from the repository root of the disposable Validation Workspace.

## Prepare

Top-level `prepare` is optional.
It contains one non-empty shell command and an optional positive integer `timeoutSeconds`.
The timeout defaults to 1200 seconds.

Repository Preparation runs in each new Managed Worktree and once before Validation Checks.
Non-zero exit or timeout creates a Prepare Finding and stops later phases.
Inability to execute or observe Prepare is a Validation Tooling Failure.

## Checks

`validation.checks` is a non-empty ordered list.
Each Check contains:

```text
id
command
timeoutSeconds
```

Check IDs are unique stable identifiers.
Commands are non-empty shell command strings.
Timeout defaults to 1200 seconds.

Every configured Check runs after Prepare passes.
An ordinary non-zero exit or timeout creates a Finding but does not stop later Checks.
Execution or observation failure creates a Validation Tooling Failure.
Any Check Finding stops reviewer phases for that Candidate.

## Copied local files

`validationWorkspace.copyFiles` is an optional non-empty list of normalized paths relative to the Local Repository's main checkout.

Each path must identify an existing regular file in that explicit local environment source.
Missing paths, directories, symbolic links, non-regular files, duplicates, and paths outside the repository reject submission.

But Why? copies each file once into the Validation Workspace.
Copied files are local environment inputs rather than Candidate content.
Their contents are not hashed, stored, included in Candidate or Validation Run identity, or exposed through Findings.
They are removed with the temporary workspace.

## Reviewer output

Reviewer output contains exactly one top-level `findings` array.
Unknown fields are rejected.

Each Finding contains:

```text
title
description
severity: critical | high | medium | low
evidence
files
artifactRefs
```

Text fields are non-empty.
File entries are normalized repository-relative paths.
Artifact references must resolve to stored validation evidence.
An empty Finding array passes the reviewer phase.
Malformed output receives the bounded structured-output retry and then becomes a Reviewer Output Contract Failure.
