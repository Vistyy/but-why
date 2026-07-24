# Agent-Assisted Setup and Manual Change Workflow

Use this guide to install But Why for one repository, configure its Agent Profile, and run the supported manual workflow.

## Copyable prompt

```text
Set up But Why for this repository.
Follow docs/public/setup.md in this repository.
Identify your current agent harness from your execution context.
Ask whether I want to use that harness or another supported harness.
Do not scan my machine for harnesses.
Detect my existing skill conventions before proposing a skill location.
Ask where to install the skill.
```

## Provide the CLI

But Why requires Node.js 24.

Use an installed `by` executable and confirm that this succeeds:

```bash
by --help
```

The package is not available from the npm registry yet.

Before publication, this guide does not define a package-installation workflow.

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

See [config.md](config.md) for the schema and the shared preparation and validation workflow.

## Configure the repository

Repo Config is tracked at `.but-why/config.json`.

Put dependency installation, restoration, synchronization, or fetch work in top-level `prepare`.

Put verification commands in `validation.checks`.

Commit `.but-why/config.json` so the policy is reviewable with the repository.

Top-level `prepare` runs when But Why creates a Managed Worktree and before Checks run in a Validation Workspace.

A successful Change Start reports `readiness: ready`.

If preparation fails, But Why preserves the Change and Managed Worktree so you can fix the policy or environment and retry.

See [config.md](config.md#repository-preparation) for the configuration contract and retry example.

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

## Run the manual Change workflow

Task commands manage intent and Task lifecycle.

Change commands manage implementation, validation, delivery, and reconciliation.

Human-facing commands below omit `--output`, so they retain the default TOON output.

Programmatic callers must add `--output json` and parse structured stdout.

### Task-backed Changes

Use a Task-backed Change when the work has approved human intent.

#### 1. Create and shape the Task

Create a description file, then create the Task:

```bash
by task create --title "Add the login flow" --description-file task.md
```

The installed command template is:

```text
by task create --title <title> --description-file <file> [--depends-on <task-id>]...
```

Set or replace direct prerequisites before approval:

```bash
by task dependencies set BY-3 --depends-on BY-1 --depends-on BY-2
```

The installed command template is:

```text
by task dependencies set <task-id> [--depends-on <task-id>]...
```

Inspect the Task and its full context:

```bash
by task show BY-3
by task context BY-3
```

The installed command templates are:

```text
by task show <task-id>
by task context <task-id>
```

Before approval, use the context draft or append a comment when the intent needs editing or clarification:

```text
by task context draft <task-id>
by task context apply <task-id>
by task comment <task-id> --file <file>
```

#### 2. Approve the intent

Approve the Task only after its title, description, comments, and prerequisites express the intended outcome:

```bash
by task approve BY-3
```

The installed command template is:

```text
by task approve <task-id>
```

Approval does not create a worktree or launch implementation.

#### 3. Start the Change

Start the approved Task-backed Change with a programmatic JSON result so an agent can capture the Change ID and Managed Worktree path:

```bash
by change start --task BY-3 --output json
```

The installed command template is:

```text
by change start [--task <task-id>]
```

The result records the Change ID, optional Task ID, branch, base ref, starting commit, and `worktreePath`.

A Task-backed Change captures immutable Acceptance Context from the approved Task.

Its later Submission includes Acceptance Review.

### Taskless Changes

Use a taskless Change for work that does not need Task intent.

Start it directly from the configured default branch:

```bash
by change start --output json
```

The command creates a Change without a Task or Acceptance Context.

It still creates and prepares a Managed Worktree.

Its later Submission runs Repository Preparation, Checks, configured Specialists, and publication policy without Acceptance Review.

The taskless Change remains eligible for code-based validation and publication.

### Repository Preparation

Change Start runs the configured top-level `prepare` command before it reports the Change as ready.

You can run or retry preparation explicitly with:

```text
by change prepare <change-id>
```

A successful human invocation looks like:

```text
$ by change prepare <change-id>
change:
  id: chg_01J...
  taskId: null
  readiness: ready
worktreePath: /path/to/.but-why/changes/chg_01J...
```

For a programmatic caller, request JSON:

```bash
by change prepare <change-id> --output json
```

A failed preparation preserves the Change and worktree and returns retryable evidence:

```json
{
  "error": {
    "code": "prepare_failed",
    "message": "Repository Preparation failed; the Change and worktree were preserved.",
    "changeId": "chg_01J...",
    "readiness": "prepare_failed",
    "worktreePath": "/path/to/.but-why/changes/chg_01J...",
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

Fix the preparation problem, then retry `by change prepare <change-id>`.

Do not start implementation until the Change reports `readiness: ready`.

### Implement in the Managed Worktree

The portable manual path is to use the recorded Managed Worktree directly.

Read `worktreePath` from the Change Start JSON result, change into that directory, edit files, and commit the implementation there:

```bash
cd <worktreePath>
# edit files
git add <paths>
git commit -m "Add the login flow"
```

The caller checkout is not the implementation workspace for a Change.

A ready Change can also launch a fresh Herdr-hosted Pi session in the recorded Managed Worktree:

```text
by change implement <change-id> [--handoff-file <path>]
```

For a programmatic caller:

```bash
by change implement <change-id> --handoff-file /tmp/handoff.md --output json
```

The result reports `changeId`, `worktreePath`, `host: "herdr"`, and `status: "started"` or `status: "already_active"`.

Preparation and Change Implement are separate operations.

The handoff file must be a non-empty regular UTF-8 file no larger than 256 KiB.

### Submit, inspect, and reconcile

Submit the current committed work from the Change Managed Worktree:

```text
by change submit <change-id>
```

For programmatic callers:

```bash
by change submit <change-id> --output json
```

A task-backed Submission runs Acceptance Review.

A taskless Submission omits Acceptance Review.

Both paths run Repository Preparation, Checks, configured Specialists, and publication policy before an eligible Candidate is published.

If validation returns Findings, fix them in the Managed Worktree, commit the fixes, and run Change Submit again:

```bash
by change submit <change-id>
```

User-owned implementation uses the Managed Worktree and repeated Change Submit.

Inspect the implementation, validation, and delivery facts with these installed command templates:

```text
by change list [--all]
by change show <change-id>
by change findings <change-id>
by change validation-runs <change-id>
```

A taskless Change with no changed Candidate returns `nothing_to_submit`, remains open, and suggests explicit cancellation.

Cancel that unchanged taskless Change with:

```text
by change cancel <change-id>
```

Cancel a Task-backed Change through its Task:

```text
by task cancel <task-id> --reason <reason>
```

After Submission publishes the owned pull request, stop and ask a human to merge it.

But Why? never merges the pull request.

After the human merge, observe the owned pull request and complete cleanup with:

```text
by change reconcile [<change-id>]
```

Use the repository-wide form to reconcile all eligible Changes or the targeted form to reconcile one Change.

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
