# Guide agents to configure validation during init

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Teach agents how to configure validation policy after `by init`.

`by init` should stay non-interactive.
It should not guess or hide dependency setup.
Instead, init output should guide the agent to inspect the repo's tooling and write explicit `.but-why/config.json` validation policy.

The goal is that an agent can initialize a repo, identify the right prepare command and check command, configure them, and then submit normally.

## Acceptance criteria

- [ ] `by init` remains non-interactive.
- [ ] Successful init output includes concise next-step guidance for validation configuration.
- [ ] No-op and repair init output include the same guidance when validation is not configured.
- [ ] Init guidance tells agents to inspect repo tooling before choosing commands.
- [ ] Init guidance says dependency setup belongs in `validation.prepare`.
- [ ] Init guidance says checks should contain only the actual verification command.
- [ ] Init guidance says But Why does not run hidden dependency setup.
- [ ] Init guidance says `.but-why/config.json` is tracked repo policy.
- [ ] Init guidance includes a minimal config example with `validation.prepare` and `validation.checks`.
- [ ] Init guidance includes prepare examples for common ecosystems:
  - [ ] Node/pnpm: `pnpm install --frozen-lockfile --prefer-offline`.
  - [ ] Python/uv: `uv sync --frozen`.
  - [ ] Rust: `cargo fetch`.
  - [ ] .NET: `dotnet restore --locked-mode`.
- [ ] Init guidance includes check examples such as `just quality`, `make test`, `cargo test`, and `dotnet test`.
- [ ] Init guidance is structured stdout that agents can parse.
- [ ] Init guidance follows AXI contextual help rules.
- [ ] `by init --help` mentions validation configuration guidance.
- [ ] Tests lock the init output shape for initialized, unchanged, and repaired states.
- [ ] `docs/config.md` documents the expected post-init configuration flow.
- [ ] `docs/setup.md` mentions configuring prepare and checks after init.

## Blocked by

- `docs/issues/042-add-validation-prepare-phase.md`
