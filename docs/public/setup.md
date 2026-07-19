# Agent-Assisted Setup Guide

Use this guide to install But Why for one repository and configure its Default Agent Profile.

## Copyable prompt for an agent

```text
Install But Why for this repository.
Follow docs/public/setup.md in this repository.
Identify your current agent harness from your execution context and ask whether I want to use it or another supported harness.
Do not scan my machine for harnesses.
Before installing the agent skill, detect my existing skill conventions and ask where to place it.
```

## Install But Why

But Why is not available from the npm registry until the package is published.
Use the current public tarball install path.

From the But Why source checkout, build a tarball with `just pack`.
Install it in the target repository with `npm install /path/to/but-why-0.0.0.tgz`, or globally with `npm install --global /path/to/but-why-0.0.0.tgz`.
Verify the Installed CLI with `npx by --help` or `by --help`.
Use an existing working installation when available.

## Initialize the repository

From the target repository root, run:

```bash
by init --task-prefix BY
```

Choose a repository-specific uppercase task prefix.
The command is non-interactive.
It creates `.but-why/config.json` and `.but-why/reviewers/` in the worktree.
SQLite state and Artifacts live at `<git-common-dir>/but-why/`, shared by every linked worktree.

Inspect repository tooling and configure top-level `prepare` and `validation.checks` explicitly in `.but-why/config.json`.
See `config.md` in this directory.

## Choose the Default Agent Profile

The setup agent identifies its current harness from its own execution context.
It asks whether to use that harness or another supported harness.
It presents these choices directly and does not scan, detect, verify, or configure installed harnesses:

<!-- supported-agent-runtimes:start -->
- `pi`
- `claude-code`
- `codex`
- `cursor`
- `opencode`
- `copilot`
<!-- supported-agent-runtimes:end -->

If the setup agent knows its current model, it suggests that model.
Otherwise it asks for a model.
All current adapters require `agentModel`.

The setup agent reads `~/.config/but-why/config.json`, preserving every existing setting and Agent Profile.
It reuses an existing profile whose `agentRuntime` and `agentModel` match the selection.
If none matches, it creates a profile named after the runtime.
If that name already has different settings, it asks the user for another profile name.
It sets `defaultAgentProfile` to the selected profile name.

Example:

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

The setup flow does not prove that the selected harness can execute.
But Why reports a typed actionable launch failure when an agent operation first attempts to use it.

## Pi worktree handoff skill

The packaged Pi skill is `skills/handoff-to-worktree/SKILL.md`.
After But Why is published, run `pi install npm:but-why` to enable it for the user.
For a source checkout, run `pi install /absolute/path/to/but-why`.
Pi then provides `/skill:handoff-to-worktree` as a user-invoked command.

`by init` does not install or configure Pi packages.

## Optional agent skill installation

The packaged skill is `docs/public/skills/but-why/SKILL.md`.
Installation is optional.

Before copying it, detect the user's existing project and user skill-location conventions from project docs, repo config, user agent config, and existing skill locations.
Show the detected conventions and ask the user to choose project scope, user scope, or skip installation.
Do not use a fixed preferred destination list.

Preserve this shape under the chosen skill root:

```text
<chosen-skill-root>/but-why/SKILL.md
```

Show the source, destination, and a short summary before copying.
Ask for explicit confirmation.
If the destination exists, show a diff or concise overwrite summary and ask before overwriting.

`by init` does not install the skill.
There is no `by` command for skill or harness configuration.
