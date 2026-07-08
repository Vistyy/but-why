# Guide init with concise validation setup next steps

## Status

Not done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add short validation setup guidance to `by init` output.

This issue owns agent-guided repository configuration after the CLI is available.
It does not own CLI packaging, npm publishing, or package installation mechanics.

`by init` should stay non-interactive.
It should not guess dependency setup.
It should not teach every ecosystem in detail.
That deeper teaching belongs in the agent skill from issue 041.

The CLI should give agents enough direction to configure explicit repo policy in `.but-why/config.json`.

## Acceptance criteria

- [ ] `by init` remains non-interactive.
- [ ] Successful init output includes concise next-step guidance when validation is not configured.
- [ ] No-op and repair init output include the same guidance when validation is not configured.
- [ ] Init guidance assumes `by` is already available through the Installed CLI or a repo-local development CLI.
- [ ] Init guidance tells agents to inspect repo tooling before choosing commands.
- [ ] Init guidance says dependency setup belongs in `validation.prepare`.
- [ ] Init guidance says verification belongs in `validation.checks`.
- [ ] Init guidance says `.but-why/config.json` is tracked repo policy.
- [ ] Init guidance tells agents to configure prepare and checks to the best of their ability based on observed repository tooling, while keeping the resulting `.but-why/config.json` explicit and reviewable.
- [ ] Init guidance points agents to the agent skill or config docs for examples.
- [ ] Init guidance is structured stdout that agents can parse.
- [ ] Init guidance follows AXI contextual help rules.
- [ ] `by init --help` mentions that init creates repo policy files and then guides validation setup.
- [ ] Tests lock the init output shape for initialized, unchanged, and repaired states.
- [ ] `docs/config.md` documents the expected post-init configuration flow.
- [ ] `docs/setup.md` mentions configuring prepare and checks after init.

## Out of scope

- Long ecosystem-specific examples in default init output.
- Hidden dependency setup chosen by But Why.
- Interactive setup questions.
- Installing or publishing the `by` CLI.
- Choosing npm package name, registry credentials, provenance, or release workflow.
- Reviewer/profile policy unless current config parsing supports it.

## Blocked by

None.
