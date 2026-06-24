# Implementation slices

The project should not be built in one shot.

Each slice should produce a working vertical increment.

## Slice 0: repository foundation

Set up the codebase and quality stack.

Target tools:

- strict TypeScript
- Biome
- Oxlint
- `tsc --noEmit`
- ast-grep
- Vitest
- Zod
- SQLite access layer

Output:

```text
pnpm check
```

## Slice 1: minimal run record

Implement a tiny CLI and run store.

Target command:

```bash
by run --intent <file> --cmd "pnpm test"
```

It should:

- create a run
- write events
- execute one command
- store logs as artifacts
- finish as pass or fail

No agents yet.

No PR handling yet.

## Slice 2: execution provider spike

Add an execution provider boundary.

Test Sandcastle as the first provider.

Prove:

- workspace creation
- command execution
- log capture
- cleanup

Keep a local-worktree fallback if Sandcastle is not reliable enough.

## Slice 3: reviewer agent

Add one read-only reviewer role.

Input:

```text
approved intent context + git diff + relevant files
```

Output:

```text
findings JSON
```

Validate output with Zod before storing findings.

Most tests should use fake agents.

Real agent runs belong in evals or smoke tests.

## Slice 4: decision requests

Add durable ask-user.

Target commands:

```bash
by status
by decisions
by respond <decision-id> --choice <choice>
by resume <run-id>
```

A run should be able to pause and resume without a live agent process.

## Slice 5: fixer loop

Add selected-finding repair.

Flow:

```text
finding selected for fix
  -> fixer agent runs in workspace
  -> changes are captured
  -> affected checks rerun
  -> reviewer reruns as needed
```

Fix policy should be explicit.

Mechanical fixes are safer than semantic fixes.

## Slice 6: PR phase

Add branch push and PR creation or update.

Use `gh-axi` for agent-facing GitHub inspection.

Use GitHub API or `gh` for deterministic internal polling if simpler.

Target behavior:

```text
local pass
  -> push branch
  -> create or update PR
  -> watch required checks
```

## Slice 7: PR babysitting

Handle base drift and CI failures.

Agent roles:

- CI diagnosis agent
- CI fixer agent
- conflict recovery agent

Agents may handle mechanical recovery.

Humans decide semantic conflicts.

## Slice 8: evals and learning loop

Add agent role evals and retrospective records.

Eval fixture shape:

```text
intent artifact
code diff
expected finding behavior
```

Retrospective record shape:

```text
missed issue
why it was missed
which step should have caught it
proposed prompt, policy, or check update
adoption status
```

## Slice 9: observability and cost

Emit structured telemetry.

Track:

- step duration
- agent calls
- token usage
- estimated cost
- retries
- decision requests
- artifact paths

Prefer OpenTelemetry and existing LLM observability tools over a custom dashboard.
