# Sandcastle v1 execution spike

## Summary verdict

Verdict: green with release and token-usage caveats.

Sandcastle main has the execution shape But Why needs for v1.
The published `@ai-hero/sandcastle@0.10.0` does not.

But Why can use Sandcastle for v1 if it depends on a release after commit `2d93226d37da129c54d4ecfd5b370122b48b31b2`, or temporarily pins an equivalent commit.
Do not build against published `0.10.0` for v1 validation execution.

## Versions tested

Published release checked:

```text
@ai-hero/sandcastle@0.10.0
v0.10.0 commit: faad913252a524dabae1ec2aa5f577d8a2824f2a
```

Main commit spiked:

```text
2d93226d37da129c54d4ecfd5b370122b48b31b2
```

The main commit reports package version `0.11.0` in its local package metadata.
It was not available from `pnpm view @ai-hero/sandcastle version` during the spike.

## Prototype path

```text
spikes/sandcastle-v1-execution/
```

Run the main-commit spike with:

```bash
pnpm --dir spikes/sandcastle-v1-execution spike-main
```

Run the reviewer portions too with:

```bash
SANDCASTLE_RUN_REVIEWER=1 \
SANDCASTLE_PI_MODEL='anthropic/claude-sonnet-4.6' \
SANDCASTLE_PI_THINKING=low \
pnpm --dir spikes/sandcastle-v1-execution spike-main
```

The prototype builds a local tarball from the Sandcastle reference checkout when needed.
That workaround exists only because the required Sandcastle commit is not published yet.

## Commands run

```bash
git -C ~/projects/references/sandcastle fetch origin main:refs/heads/main
git -C ~/projects/references/sandcastle checkout main
git -C ~/projects/references/sandcastle reset --hard 2d93226d37da129c54d4ecfd5b370122b48b31b2

pnpm --dir spikes/sandcastle-v1-execution install --frozen-lockfile=false
pnpm --dir spikes/sandcastle-v1-execution typecheck
pnpm --dir spikes/sandcastle-v1-execution spike-main

SANDCASTLE_RUN_REVIEWER=1 \
SANDCASTLE_PI_MODEL='anthropic/claude-sonnet-4.6' \
SANDCASTLE_PI_THINKING=low \
pnpm --dir spikes/sandcastle-v1-execution spike-main
```

## What worked on Sandcastle main

- A disposable submitted commit was created on a task branch.
- A temp validation branch was created at the submitted commit.
- Sandcastle created an isolated validation worktree from that temp branch.
- `sandbox.exec()` ran a passing configured command in the validation worktree.
- `sandbox.exec()` ran a failing configured command in the validation worktree.
- The failing command returned `exitCode`, `stdout`, and `stderr` without throwing.
- The failed command was mapped to the v1 `Finding` shape.
- A Pi reviewer ran through Sandcastle from the validation branch.
- Reviewer output was validated with `Output.object(...)` and an Effect Schema Standard Schema adapter.
- Invalid reviewer JSON was corrected through Sandcastle structured-output retry using `maxRetries: 1`.
- Sandcastle produced file log paths for reviewer runs.
- Docker sandbox execution worked with a Pi-capable image.
- Pi reviewer execution inside Docker worked when `~/.pi/agent/auth.json` was mounted read-only into `/home/agent/.pi/agent/auth.json`.
- Cleanup removed the Sandcastle worktree, temp validation branch, and disposable fixture repo.

## Evidence from the successful reviewer run

The retry run intentionally returned invalid v1 severity first:

```json
"severity": "warning"
```

The schema only allowed:

```text
critical | high | medium | low
```

The final returned structured output was valid:

```json
{
  "title": "Retry proof",
  "description": "First response is intentionally invalid.",
  "severity": "low",
  "evidence": "This should fail schema validation because warning is not a v1 severity.",
  "files": ["feature.txt"],
  "artifactRefs": ["artifact:BY-1.1/intent_review/intent-review-retry/output.json"]
}
```

The prototype output showed two Sandcastle starts for the retry log path, followed by one valid structured result.
That matches the expected retry behavior.

## What failed or remains unproven

Published `0.10.0` is not sufficient.
It lacks the public `sandbox.exec()` command seam and lacks structured output retry via `maxRetries`.

The spike first used `SANDCASTLE_SANDBOX=none`, then later proved Docker with `SANDCASTLE_SANDBOX=docker` and image `sandcastle:but-why-spike-pi`.
Podman remains untested.

Pi token usage was not returned in `result.iterations[].usage` for the tested Pi model and runtime.
But Why can still record missing usage fields, but v1 token accounting needs one more runtime-specific check before implementation.

The Sandcastle main build required adding `@standard-schema/spec` while packing from source.
That appears to be a package metadata issue in the unpublished main checkout.
A published release should include the dependency correctly before But Why depends on it.

## Workarounds used

The spike packed Sandcastle main into a local tarball under `/tmp` because the needed APIs are not published in `0.10.0`.

The prototype script modifies only a temporary copy of Sandcastle before packing it.
It does not modify `~/projects/references/sandcastle` except to check out the target commit.

The prototype uses `noSandbox()` by default.
Set `SANDCASTLE_SANDBOX=docker` and `SANDCASTLE_IMAGE_NAME=sandcastle:but-why-spike-pi` to run in Docker.
Set `SANDCASTLE_MOUNT_PI_AUTH=1` to mount host Pi auth read-only for Pi reviewer smoke tests.
Podman remains available as a later smoke path.

## Recommendation

Keep Sandcastle as the intended v1 execution engine.

Required next action:

- Depend on a Sandcastle release that includes `sandbox.exec()` and structured output `maxRetries`, or pin commit `2d93226d37da129c54d4ecfd5b370122b48b31b2` temporarily.

Do not implement a custom command runner unless Sandcastle does not release or stabilize these APIs.

## Documentation changes needed

Update the Sandcastle open question from unknown to green with release and token-usage caveats.
Keep the dependency decision proposed until a released Sandcastle version with the required APIs is available.

Token accounting remains open for Pi until `result.iterations[].usage` is fixed for Pi or But Why chooses another accounting source.
