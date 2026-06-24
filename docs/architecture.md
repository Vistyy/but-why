# Current architecture plan

## Product shape

But Why? is a thin validation brain around existing execution tools.

It should not become a large workflow platform.

It should make agent-assisted work safer by validating finished code against approved human intent.

## Main components

```text
But Why? core
  - run state
  - findings
  - decision requests
  - policy loop
  - PR and CI babysitting

Execution provider
  - workspaces
  - sandboxes
  - command execution
  - agent execution
  - logs and artifacts

Agent providers
  - Pi
  - Claude
  - Codex
  - ACP or acpx later

External systems
  - Git
  - GitHub
  - repo checks
  - optional Dagger
  - optional observability tools
```

## External tools under consideration

| Area | Candidate | Role |
|---|---|---|
| Execution harness | Sandcastle | Worktrees, sandboxes, agent runs, command runs, logs |
| Coding agents | Pi SDK, Claude SDK, Codex SDK | Reviewer, fixer, CI, conflict agents |
| Checks | repo scripts, just, mise, Dagger | Test, lint, typecheck, build |
| GitHub | gh-axi, gh, GitHub API | PR creation, PR inspection, CI status |
| State | SQLite | Durable local source of truth |
| Schemas | Zod, JSON Schema | Validate agent output and stored records |
| Code quality | strict TypeScript, Biome, Oxlint, ast-grep, tsc | Reduce implementation slop |
| Tests | Vitest, fast-check, golden fixtures, agent evals | Catch regressions and prompt drift |

## What stays under our control

The core owns validation semantics.

That includes:

- approved intent references
- run states
- finding model
- decision request model
- ask-user and respond semantics
- fix policy
- agent role prompts
- PR babysitting policy
- retrospective learning records

## What should be delegated

The core should avoid owning generic execution plumbing when possible.

Delegate:

- workspace creation
- sandbox execution
- command running
- agent process management
- GitHub API mechanics
- test environment setup
- logging transport
- observability export

## Intent model

Approved intent is not an implementing agent summary.

It is a mechanical reference to context that was approved or otherwise authoritative.

Examples:

- reviewed Lavish artifact
- issue or ticket context
- approved chat excerpt
- explicit user-provided intent file
- PR description if approved by workflow

The minimal internal record is:

```text
IntentRef
  id
  source artifacts
  content hashes
  approval source
  approved at
  approved by
```

Reviewer agents use the referenced context to judge the diff.

The gate does not ask the implementing agent what the intent was.

## Ask-user model

Ask-user should be stronger than no-mistakes.

It should be a durable decision request, not only an in-memory approval gate.

```text
finding requires human judgment
  -> create decision request
  -> pause run
  -> surface request through CLI, TUI, PR, or agent tool
  -> record answer
  -> resume from checkpoint
```

## Execution provider boundary

Sandcastle may become the first execution provider.

It should still sit behind our own interface.

```text
ExecutionProvider
  createWorkspace
  runCommand
  runAgent
  collectArtifacts
  cleanup
```

This lets us lean on Sandcastle without making it the product architecture.
