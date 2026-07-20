# Agent-Assisted Setup Guide

Use this guide to install But Why for one repository and configure its Default Agent Profile.

## Copyable prompt

```text
Install But Why for this repository.
Follow docs/public/setup.md in this repository.
Identify your current agent harness from your execution context.
Ask whether I want to use that harness or another supported harness.
Do not scan my machine for harnesses.
Detect my existing skill conventions before proposing a skill location.
Ask where to install the skill.
```

## Install But Why

But Why requires Node.js 24.
The package is not available from the npm registry yet.

From the But Why source checkout, build a tarball:

```bash
just pack
```

Install the tarball in the target repository:

```bash
npm install /path/to/but-why-0.0.0.tgz
npx by --help
```

Alternatively, install the tarball globally:

```bash
npm install --global /path/to/but-why-0.0.0.tgz
by --help
```

Use an existing working installation when one is available.

## Initialize the repository

From the target repository root, run:

```bash
by init --task-prefix BY
```

Replace `BY` with a repository-specific uppercase Task prefix.
The command creates `.but-why/config.json` and `.but-why/reviewers/` in the worktree.
It stores SQLite state and Artifacts under `<git-common-dir>/but-why/` so every linked worktree shares them.

Inspect the repository tooling before you edit `.but-why/config.json`.
Add `validation.checks`.
Configure top-level `prepare` when the repository needs dependency installation or other setup.
See [config.md](config.md) for the schema and Agent Profile rules.

## Choose the Default Agent Profile

The setup agent must identify its current harness from its execution context.
It must ask whether to use that harness or another supported runtime.
It must not scan the machine for installed harnesses.

<!-- supported-agent-runtimes:start -->
- `pi`
- `claude-code`
- `codex`
- `cursor`
- `opencode`
- `copilot`
<!-- supported-agent-runtimes:end -->

See [Agent Profiles](config.md#agent-profiles) for runtime configuration.

If the setup agent knows its current model, it should suggest that model.
Otherwise, it must ask for a model.
All current adapters require `agentModel`.

The setup agent must preserve every existing setting and Agent Profile in `~/.config/but-why/config.json`.
It should reuse a profile whose `agentRuntime` and `agentModel` match the selection.
If no profile matches, it must create a profile named after the runtime.
If that name has different settings, it must ask the user for another profile name.
It must set `defaultAgentProfile` to the selected profile name.

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

Setup does not verify that the selected harness can run.
If a launch fails, But Why reports a typed error with a recovery action.

## Install the optional agent skill

The packaged skill is `docs/public/skills/but-why/SKILL.md`.

1. Inspect project documentation, repository configuration, user agent configuration, and existing skill locations for skill conventions.
2. Show the detected conventions.
3. Ask the user to choose project scope, user scope, or no installation.
4. Show the source, destination, and a short summary.
5. Ask for confirmation.
6. Copy the skill after the user confirms.

Preserve this path under the chosen skill root:

```text
<chosen-skill-root>/but-why/SKILL.md
```

If the destination exists, show a diff or concise overwrite summary.
Overwrite the destination only after the user confirms.

`by init` does not install the skill.
But Why does not provide a command for skill or harness configuration.
