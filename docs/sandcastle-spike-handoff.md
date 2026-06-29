# Sandcastle Spike Handoff

This handoff is for the agent implementing the Sandcastle spike.

The goal is to prove whether Sandcastle can be the v1 execution engine for But Why?.

Do not build the product during this spike.

Only prove the execution behavior and document the result.

## Required reading

Read these first:

- `AGENTS.md`
- `CONTEXT.md`
- `docs/architecture.md`
- `docs/prd.md`
- `docs/issues/001-prove-sandcastle-v1-execution.md`
- `docs/open-questions.md`
- `docs/config.md`
- `docs/adr/0002-use-sandcastle-as-v1-execution-engine.md`

Also inspect the reference checkout:

```text
~/projects/references/no-mistakes
```

Use it only for comparison.

Do not copy its architecture blindly.

## Spike question

Can But Why? use Sandcastle for v1 execution plumbing without reimplementing it?

The spike must answer yes, no, or yes with specific patches/workarounds.

## Behaviors to prove

Prove these behaviors in a small prototype:

1. Create a validation worktree from a temp ref.
2. Run a configured command check in that worktree.
3. Run a Pi reviewer agent in that worktree.
4. Validate structured reviewer JSON output.
5. Retry invalid structured output in the same agent thread.
6. Collect logs and artifacts.
7. Read token usage split by input, cached input, output, and total if available.
8. Clean up the validation worktree and temp ref.

## Important constraints

But Why? should not reimplement Sandcastle features.

Do not write a custom agent runner.

Do not write a custom structured-output retry loop unless Sandcastle cannot support it.

Do not write custom worktree lifecycle code beyond what is needed to create the temp validation ref.

Use Sandcastle directly where possible.

Wrap only But Why domain seams.

Good seam names are:

```text
createValidationWorkspace
runCheckRound
runReviewerRound
```

Bad seam names are:

```text
createWorkspace
runCommand
runAgent
collectArtifacts
cleanup
```

## Expected prototype shape

Create the smallest possible prototype or notes under a spike location.

Suggested location:

```text
docs/spikes/sandcastle-v1-execution.md
```

If code is needed, keep it isolated under a spike directory.

Suggested location:

```text
spikes/sandcastle-v1-execution/
```

The prototype should not become production code unless explicitly approved later.

## Suggested test scenario

Use a tiny temporary git repo or disposable fixture repo.

The repo should have:

- one normal base branch
- one task branch
- one committed change on the task branch
- one check command that passes
- one check command that can be made to fail
- one reviewer prompt that returns valid findings JSON
- one reviewer prompt that intentionally returns invalid output first, then corrects it

The spike should validate a submitted commit without mutating the original checkout.

## Temp ref and worktree rule

Do not validate the checked-out task branch directly.

Use this shape:

```text
task branch commit = abc123
create temp validation ref at abc123
Sandcastle creates validation worktree from temp ref
run validation there
remove validation worktree and temp ref
```

This avoids Git worktree conflicts when the task branch is already checked out.

## Structured reviewer output

Use the v1 finding shape:

```text
title
description
severity: critical | high | medium | low
evidence
files
artifactRefs
```

Reviewer output should be JSON.

Use Effect Schema if the prototype is inside the But Why? codebase.

If Sandcastle requires Standard Schema, prove how Effect Schema will connect to it.

If that connection is awkward, document the exact adapter needed.

## Same-thread retry

The spike must prove whether Sandcastle can correct invalid structured output in the same agent session.

Expected behavior:

```text
agent returns invalid output
Sandcastle sends correction message in same session
agent returns valid JSON
Sandcastle validates and returns structured data
```

If Sandcastle only supports rerunning a new session, document that as a blocker or tradeoff.

## Logs and artifacts

Record what Sandcastle produces for:

- command stdout
- command stderr
- agent transcript or stream
- structured output
- validation errors
- retry prompts

Map these to the intended But Why artifact ref shape:

```text
artifact:<run-id>/<phase>/<producer>/<filename>
```

Do not invent a final artifact system in this spike.

Only prove what Sandcastle gives us and what But Why must store.

## Token usage

Record exactly what Sandcastle returns for token usage.

Map it to the intended But Why fields:

```text
producerId
agentRuntime
agentModel
inputTokens
cachedInputTokens
outputTokens
totalTokens
```

If cached input tokens are missing, document that.

If usage is runtime-specific, document which runtimes provide which fields.

V1 tracks tokens only.

Do not add dollar cost calculation.

## Command checks

Prove that Sandcastle can run configured repo commands.

Example commands:

```text
just validate
pnpm check
./scripts/validate.sh
```

The spike can use any simple command.

The important behavior is:

```text
command runs in validation worktree
logs are captured
exit code is observable
failure can be turned into a But Why finding later
```

## Pi reviewer agent

Use Pi through Sandcastle if possible.

Use the current project vocabulary:

```text
agentRuntime = pi
agentModel = openai-codex/gpt-5.5
```

The exact model can be changed for the local environment.

Document the model used.

Do not call this field `provider` in But Why docs or examples.

## Deliverable

Write a final spike report.

Suggested path:

```text
docs/spikes/sandcastle-v1-execution.md
```

The report must include:

- summary verdict
- exact Sandcastle version or commit tested
- commands run
- prototype path if any
- what worked
- what failed
- required workarounds
- whether But Why can use Sandcastle for v1
- changes needed to `docs/architecture.md`, `docs/prd.md`, or issue drafts

## Go/no-go criteria

Green means Sandcastle can handle:

- validation worktree creation from a temp ref
- command checks
- Pi reviewer agents
- structured output validation
- same-thread structured output retry
- logs
- token usage
- cleanup

Yellow means Sandcastle can work with small patches or narrow workarounds.

Red means But Why would need to reimplement too much execution plumbing.

If the result is yellow or red, do not start product implementation.

Update `docs/open-questions.md` with the blocker or decision needed.
