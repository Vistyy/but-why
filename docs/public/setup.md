# Set Up But Why

This guide is for a user or agent that installs But Why in one Git repository.
It answers how to install the CLI and the portable Pi skill, initialize repository policy, and find the workflow authority.
The installed `but-why` skill owns Work Route Selection, Task authoring, and Implementation Authorization.

## Install the CLI

But Why requires Node.js 24.
This Candidate is unreleased, so the But Why source checkout must also be the target repository.
Run unreleased commands from that checkout with `just by`.

From the source checkout, enter the locked environment and initialize dependencies:

```bash
nix develop
just init
```

Verify the unreleased command prefix:

```bash
just by --help
```

After publication, use But Why from a separate target repository.
Verify one published command prefix:

```bash
pnpx but-why --help
```

Use `npx -y but-why --help` only when `pnpx` is unavailable.
Resolve one command prefix before running But Why commands.
Let `<but-why>` represent that prefix below.

## Install the Pi package

Pi installs the model-visible But Why skill from the package manifest.
Install the published package for the current user:

```bash
pi install npm:but-why
```

To install the package for one trusted target repository, run this command from that repository:

```bash
pi install npm:but-why -l
```

During development, install the local package by its absolute path:

```bash
pi install /absolute/path/to/but-why
```

Pi records the package source in its settings and discovers the packaged `but-why` skill at startup.
Run `pi list` to verify that Pi records the package.

When package installation is unavailable, use Pi's explicit skill option with an unpacked But Why package:

```bash
pi --skill /absolute/path/to/but-why/docs/public/skills/but-why
```

Do not copy the skill into another skill directory.
The package directory contains the references and Implementer instructions that the skill requires.

## Initialize repository policy

In the target repository, initialize But Why with a repository-specific uppercase Task prefix:

```bash
<but-why> init --task-prefix BY
```

The command creates `.but-why/config.json` and `.but-why/reviewers/`.
It stores SQLite state and Artifacts under `<git-common-dir>/but-why/` so linked worktrees share them.

But Why creates each disposable Snapshot Workspace in the Local Repository sibling worktree root under `<main-checkout-name>-worktrees/but-why/validation-runs/`.

Inspect repository tooling before editing `.but-why/config.json`.
Add at least one `validation.checks` entry.
Add top-level `prepare` when dependency installation or another setup action is required.
See [But Why Config](config.md) for the schema.

Before starting a Change, commit and push `.but-why/config.json` and configured reviewer files to the remote branch that will be the Change Base:

```bash
git add .but-why/config.json .but-why/reviewers
git commit -m "Configure But Why"
git push <publication-remote> <base-branch>
```

Replace `<publication-remote>` with the GitHub remote selected by But Why for this repository.
Inspect configured remotes with `git remote -v`.
When multiple GitHub remotes exist, But Why prefers the main checkout's upstream remote and then `origin`.
Otherwise, But Why reports an ambiguous publication remote.
Use the same remote that Change Start selects because Change Start reads Repo Config from the fetched Change Base commit.

## Configure agents

Repo Config is tracked at `.but-why/config.json`.
Global Config is stored at `~/.config/but-why/config.json`.

Set `agentEnvironment.command` when headless reviewers must enter the repository development environment.
Interactive Implementer Sessions use the Herdr pane shell environment and do not apply this setting:

```json
{
  "agentEnvironment": {
    "command": ["nix", "develop", "-c"]
  }
}
```

See [But Why Config](config.md#agent-environment) for wrapper configuration and behavior.

The setup agent must identify Pi from its execution context and must not scan the machine for harnesses.

<!-- supported-agent-runtimes:start -->
- `pi`
<!-- supported-agent-runtimes:end -->

Preserve existing Global Config settings and Agent Profiles.
Create separate editable Global `reviewer` and `implementer` profiles when they are absent.
Set the two role selections as required for review and interactive implementation.
Users may edit or replace either profile.

See [Global Config and Agent Profiles](config.md#global-config-and-agent-profiles) for profile fields, selection, and resource rules.

## Use the workflow

Start Pi in the target repository and use the installed `but-why` skill.
The skill loads this setup guide before it gives setup guidance.
It loads its operator workflow before it selects work, records Tasks, or authorizes implementation.
