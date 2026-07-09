# Agent-Assisted Setup Guide

Use this guide to install But Why for one repository.

## Copyable prompt for an agent

```text
Install But Why for this repository.
Follow docs/public/setup.md in this repository.
Before installing the agent skill, detect my existing skill conventions and ask where to place it.
```

## Install But Why

But Why is not available from the npm registry until the package is published.
Use the current public tarball install path.

From the But Why source checkout, build a tarball:

```bash
just pack
```

Install that tarball where you need the `by` CLI.
For a project-local install in the target repository:

```bash
npm install /path/to/but-why-0.0.0.tgz
npx by --help
```

For a global install:

```bash
npm install --global /path/to/but-why-0.0.0.tgz
by --help
```

If `by --help` already works in the target repository, use the existing install.

## Initialize the repository

Run init from the target repository root after the `by` CLI is available:

```bash
by init --task-prefix BY
```

Choose a repository-specific uppercase task prefix.
The command is non-interactive.
It creates `.but-why/config.json`, `.but-why/state.sqlite`, `.but-why/reviewers/`, and managed ignore entries for local runtime state.

After init, configure validation policy in `.but-why/config.json`.
That file is tracked repo policy.
Inspect the repository tooling before choosing commands.
Configure `validation.prepare` and `validation.checks` to the best of your ability from observed tooling.
Keep the resulting config explicit and reviewable.

Use `config.md` in this directory for config fields and examples.

## Optional agent skill installation

The But Why agent skill is recommended when an agent will run `by` commands for this repository.
Skill installation is optional.
A user may skip it and still use the CLI.

The packaged skill source is:

```text
docs/public/skills/but-why/SKILL.md
```

Install it only after the user confirms the destination.
Do not use a fixed preferred destination list.
Detect the user's existing project and user skill-location conventions first.
Inspect project docs, repo config, user agent config, and existing skill locations that are already present.
Show the detected conventions to the user.
Then ask the user to choose project scope, user scope, or skip skill installation.

When the user chooses a scope, preserve this folder shape under the chosen skill root:

```text
<chosen-skill-root>/but-why/SKILL.md
```

Before copying, show the source path, destination path, and a short summary of the file that will be installed.
Ask for explicit confirmation before copying.

If `<chosen-skill-root>/but-why/SKILL.md` already exists, compare it with the packaged skill.
Show a diff or concise overwrite summary.
Ask for explicit confirmation before overwriting.

`by init` does not install or copy the skill.
There is no `by` command for skill installation.
