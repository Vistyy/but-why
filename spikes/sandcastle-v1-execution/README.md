# Sandcastle v1 execution spike prototype

PROTOTYPE - throwaway code for issue `docs/issues/001-prove-sandcastle-v1-execution.md`.

Question: Can But Why? use Sandcastle for v1 validation execution without reimplementing worktree lifecycle, command execution, reviewer execution, structured output retry, logs, token usage, or cleanup plumbing?

This is a logic prototype.
It creates a disposable git fixture repo, creates a temp validation branch at a submitted commit, asks Sandcastle to create a validation worktree, runs configured checks, optionally runs a Pi reviewer with structured JSON output, then cleans up.

Run the Sandcastle main spike with one command:

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

For manual interactive driving after dependencies are installed:

```bash
pnpm --dir spikes/sandcastle-v1-execution start
```

Useful environment variables:

```text
SANDCASTLE_SANDBOX=none|docker|podman
SANDCASTLE_IMAGE_NAME=sandcastle:but-why-spike-pi
SANDCASTLE_MOUNT_PI_AUTH=1
SANDCASTLE_PI_AUTH_JSON=~/.pi/agent/auth.json
SANDCASTLE_PI_MODEL=openai-codex/gpt-5.5
SANDCASTLE_PI_THINKING=low|medium|high
SANDCASTLE_RUN_REVIEWER=1
```

Build the Docker smoke-test image with:

```bash
pnpm --dir spikes/sandcastle-v1-execution build-docker-image
```

Run the Docker sandbox smoke with:

```bash
SANDCASTLE_SANDBOX=docker \
SANDCASTLE_IMAGE_NAME=sandcastle:but-why-spike-pi \
pnpm --dir spikes/sandcastle-v1-execution spike-main
```

Run the Docker Pi reviewer smoke with host Pi auth mounted read-only:

```bash
SANDCASTLE_SANDBOX=docker \
SANDCASTLE_IMAGE_NAME=sandcastle:but-why-spike-pi \
SANDCASTLE_MOUNT_PI_AUTH=1 \
SANDCASTLE_PI_AUTH_JSON=~/.pi/agent/auth.json \
SANDCASTLE_RUN_REVIEWER=1 \
SANDCASTLE_PI_MODEL='openai-codex/gpt-5.5' \
SANDCASTLE_PI_THINKING=low \
pnpm --dir spikes/sandcastle-v1-execution spike-main
```

Default sandbox is `none` so the prototype can run on hosts without Docker or Podman.
That still exercises Sandcastle's worktree and execution APIs, but it does not prove container isolation.
Use `SANDCASTLE_SANDBOX=docker` or `podman` where available before calling the spike fully green.

This prototype targets Sandcastle main commit `2d93226d37da129c54d4ecfd5b370122b48b31b2` because published `0.10.0` lacks `sandbox.exec()` and structured output retry.

Delete this directory after the spike decision is captured in `docs/spikes/sandcastle-v1-execution.md`.
