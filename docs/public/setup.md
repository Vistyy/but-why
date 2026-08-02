# Agent-Assisted Setup and Manual Change Workflow

This guide is for a user or agent installing But Why in one Git repository.
It answers how to install the unreleased CLI candidate, initialize repository policy, configure agents, and submit a Change.

## Copyable setup prompt

```text
Set up But Why for this repository.
Follow docs/public/setup.md in this repository.
Identify your current agent harness from your execution context.
Ask whether I want to use that harness or another supported harness.
Do not scan my machine for harnesses.
Detect existing skill conventions before proposing a skill location.
Configure recursive formatter, linter, test, and analysis tools to exclude `.sandcastle/**`.
Ask where to install the skill.
```

## Install and initialize

But Why requires Node.js 24.
This Candidate is unreleased, so the But Why source checkout must also be the target repository.
Run all unreleased `just by` commands from that checkout.
After publication, use `pnpx but-why` or `npx -y but-why` from a separate target repository.
From the source checkout, enter the locked environment:

```bash
nix develop
```

Initialize the source checkout before verifying the command prefix:

```bash
just init
```

Verify the unreleased command prefix with:

```bash
just by --help
```

After publication, verify a published package with `pnpx but-why --help` or `npx -y but-why --help`.
In every command below, replace the leading `by` placeholder with the resolved prefix.
For example, use `just by init --task-prefix BY` in the source checkout or `pnpx but-why init --task-prefix BY` after publication.

Initialize But Why in the source checkout:

```bash
by init --task-prefix BY
```

Replace `BY` with a repository-specific uppercase Task prefix.

`by init` creates `.but-why/config.json` and `.but-why/reviewers/`.
It adds Git ignore rules for Sandcastle runtime files under `.sandcastle/`.
It stores SQLite state and Artifacts under `<git-common-dir>/but-why/` so linked worktrees share them.

Configure recursive formatter, linter, test, and analysis tools to exclude `.sandcastle/**`.
Sandcastle creates disposable Validation Workspaces below that directory.

Inspect repository tooling before editing `.but-why/config.json`.
Add at least one `validation.checks` entry.
Add top-level `prepare` when dependency installation or another setup action is required.
See [But Why Config](config.md) for the schema.

Before starting a Change, commit and push `.but-why/config.json` and any configured reviewer files to the remote branch that will be the Change Base:

```bash
git add .but-why/config.json .but-why/reviewers
git commit -m "Configure But Why"
git push <publication-remote> <base-branch>
```

Replace `<publication-remote>` with the GitHub remote selected by But Why for this repository.
Inspect configured remotes with `git remote -v`.
When multiple GitHub remotes exist, But Why prefers the main checkout's upstream remote, then `origin`; otherwise it reports an ambiguous publication remote.
Use the same remote that Change Start will select, because Change Start reads Repo Config from the fetched Change Base commit.

## Configure agents

Repo Config is tracked at `.but-why/config.json`.
Global Config is stored at `~/.config/but-why/config.json`.

Set `agentEnvironment.command` when host-run agents must enter the repository's development environment:

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

## Start a Change

Task commands manage intent and Task lifecycle.
Change commands manage implementation, validation, delivery, and reconciliation.
Human-facing commands omit `--json` and use default TOON output.
Programmatic callers put `--json` before the command.

Create and approve a Task when the work needs durable intent:

```bash
by task create --title "Add the login flow" --description-file task.md
by task approve BY-3
```

Set or edit prerequisites before approval with an operation that states its complete graph effect:

```bash
by task dependencies replace BY-3 --depends-on BY-1 --depends-on BY-2
by task dependencies add BY-3 --depends-on BY-4
by task dependencies remove BY-3 --depends-on BY-1
by task dependencies clear BY-3
```

The live dependency graph is authoritative.
Do not duplicate prerequisite lists in Task Context.

Inspect Task metadata and complete Task Context:

```bash
by task show BY-3
by task context BY-3
```

Start a Task-backed Change:

```bash
by --json change start --task BY-3
```

Start a taskless Change when no approved Task intent is required:

```bash
by --json change start
```

Change Start fetches the detected publication remote.
Without `--base`, it uses the remote default branch.
With `--base <branch>`, it uses that remote branch.
Local branches cannot supply a Change Base.

Read `worktreePath` from the result and implement only in that Managed Worktree.
Change Start runs Repository Preparation before it reports `readiness: ready`.

## Submit and inspect

Commit the Candidate in the Managed Worktree, then submit it:

```bash
by change submit <change-id>
```

Change Submit first reconciles an existing owned pull request.
A new Submission fetches the recorded Change Base before Candidate capture.
The Repository Branch must contain the fetched Change Base commit.
If it does not, merge or rebase the Change Base into the Repository Branch and retry.
The fetch and ancestry rejection do not modify the Managed Worktree or Repository Branch.

A changed Task-backed Candidate runs Repository Preparation, Checks, Acceptance Review, configured Specialists, and publication policy.
A changed taskless Candidate runs Repository Preparation, Checks, configured Specialists, and publication policy without Acceptance Review.
An unchanged taskless Change returns `nothing_to_submit` before validation.
An unchanged Task-backed Change uses the acceptance-only policy: it runs Acceptance Review without Checks or configured Specialists and can complete without a pull request.

If Change Submit returns `error.recovery`, follow the exact recovery instruction for that Change without additional user approval.
If it returns Findings, inspect them, fix the Managed Worktree, commit the fixes, and submit again.

The targeted Change commands infer the Change ID when the canonical current worktree path and Repository Branch match exactly one recorded Managed Worktree.
If the facts do not match exactly one record, rerun the command with `<change-id>`.
`by change reconcile` keeps its repository-wide omitted-ID behavior.

The installed command templates are:

```text
by task create --title <title> --description-file <file> [--depends-on <task-id>]...
by task dependencies add <task-id> --depends-on <task-id> [--depends-on <task-id>]...
by task dependencies remove <task-id> --depends-on <task-id> [--depends-on <task-id>]...
by task dependencies replace <task-id> --depends-on <task-id> [--depends-on <task-id>]...
by task dependencies clear <task-id>
by task list [--all] [--state <state>] [--limit <positive integer | all>]
by task show <task-id>
by task approve <task-id>
by task context <task-id>
by task context draft <task-id>
by task context apply <task-id>
by task comment <task-id> --file <file>
by task cancel <task-id> --reason <reason>
by change start [--task <task-id>] [--base <branch>]
by change prepare [<change-id>]
by change list [--all]
by change show [<change-id>]
by change findings [<change-id>]
by change publications [<change-id>]
by change validation-runs [<change-id>]
by validation-run show <validation-run-id>
by validation-run artifact <validation-run-id> <artifact-ref>
by validation-run abandon <validation-run-id> --reason <reason>
by change submit [<change-id>]
by change cancel [<change-id>]
by change reconcile [<change-id>]
by change implement [<change-id>] [--handoff-file <path>]
by change decision add <change-id> --file <path>
by change blocker raise <change-id> --file <path>
by change blocker resolve <change-id> --file <path>
by change blocker list <change-id>
by change decision list <change-id>
```

`by task list` returns the oldest five matching Tasks by default.
Use `--limit <positive integer>` to change the bound or `--limit all` to return the complete matching inventory.
Filtering occurs before oldest-first ordering and limiting.
The result reports `count` for returned Tasks and `total` for all matching Tasks.
A truncated result includes help for retrieving all matching Tasks.

Use `by task show` for Task metadata and `by task context` for the complete Task Context.
Use `by change show` for current Change state and its reported expansion commands.
Use `by change findings` for current Findings.
Use `by change validation-runs` for compact Validation Run History.
Use `by change publications` for the complete ordered Candidate Publication history.

Candidate Publication makes the current Candidate ready for human review.
Keep the Change open while review is in progress.
After review corrections, record new Implementation Decisions, change the Managed Worktree, and run `by change submit` again.
Each successful revised Submission updates the same owned open pull request and appends immutable publication evidence.
Reconciliation completes the Change only when the merged pull request head matches the latest Candidate Publication.
Use `by validation-run show` for one Validation Run's policy and recorded evidence.
Use `by validation-run artifact` for complete stored Artifact content.

A taskless Change with no tracked tree change returns `nothing_to_submit` before validation and remains open.
A Task-backed no-change Submission uses the acceptance-only policy: it runs Acceptance Review without Checks or configured Specialists and can complete without a pull request.

Cancel an open taskless Change when the work is no longer needed:

```bash
by change cancel <change-id>
```

Cancel a Task-backed Change through its unfinished Task:

```bash
by task cancel <task-id> --reason <reason>
```

Cancellation is permanent.
Task cancellation records the reason and prevents the Task from completing through the cancelled Change.

If implementation cannot safely continue without external authority or action, inspect the blocker and wait for an approved Resolution:

```text
by change blocker list <change-id>
by change blocker resolve <change-id> --file <path>
```

Do not use an Implementation Blocker for Findings, tooling recovery, publication recovery, or ordinary implementation difficulty.

After Change Submit reports a ready owned pull request, the implementation agent reports its URL and waits for human merge.
But Why does not merge pull requests.
After the human merge, the user closes the Herdr Interactive Session manually.
Then the main operator session runs Reconcile:

```bash
by change reconcile <change-id>
```

Reconciliation closes the Change and completes its linked Task only when the owned pull request is merged at the latest Candidate Publication head.

## Install the optional agent skill

The packaged skill is `docs/public/skills/but-why/SKILL.md`.

1. Inspect project documentation, repository configuration, user agent configuration, and existing skill locations.
2. Show the detected conventions.
3. Ask the user to choose project scope, user scope, or no installation.
4. Show the source, destination, and a short summary.
5. Copy the skill only after confirmation.

Preserve this path under the chosen skill root:

```text
<chosen-skill-root>/but-why/SKILL.md
```

If the destination exists, show a diff or concise overwrite summary before requesting confirmation.
`by init` does not install the skill.
