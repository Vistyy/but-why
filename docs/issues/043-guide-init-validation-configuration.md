# Guide init with concise validation setup next steps

## Status

Done.

## Parent

`docs/prds/v1-validation-prd.md`

## What to build

Add short validation setup guidance to `by init` output.

This issue also moves configured checks under `validation.checks`, so validation setup lives under one `validation` object.
After this issue, `validation.checks` is the canonical repo config path for verification commands.

This issue also introduces shipped public docs under `docs/public/`.
Init and help output should point agents to those shipped docs instead of teaching config inline.

This issue owns agent-guided repository configuration after the CLI is available.
It does not own CLI packaging, npm publishing, or package installation mechanics.

`by init` should stay non-interactive.
It should not guess dependency setup.
It should not teach every ecosystem in detail.
That deeper teaching belongs in the agent skill from issue 041.

The CLI should give agents enough direction to find the shipped config docs and configure explicit repo policy in `.but-why/config.json`.

Init guidance should not branch on validation configuration state.
It should always include a lightweight next step pointing agents to shipped public setup or config docs.

## Acceptance criteria

- [x] `by init` remains non-interactive.
- [x] Successful init output includes concise next-step guidance pointing to shipped public docs.
- [x] No-op and repair init output include the same docs guidance.
- [x] Init guidance does not branch on whether validation is already configured.
- [x] Init guidance assumes `by` is already available through the Installed CLI or a repo-local development CLI.
- [x] Init guidance tells agents to inspect repo tooling before choosing commands.
- [x] Public docs for installed users live under `docs/public/`.
- [x] Package contents include `docs/public/`.
- [x] Package contents do not include internal planning docs such as `docs/issues/`, `docs/prds/`, `docs/adr/`, `docs/spikes/`, or `docs/open-questions.md`.
- [x] Init guidance points to the shipped config docs by resolved installed path.
- [x] `by --help` points to shipped public docs by resolved installed path.
- [x] `by init --help` points to shipped public docs by resolved installed path.
- [x] Repo config schema accepts checks at `validation.checks`.
- [x] Repo config schema no longer accepts top-level `checks`.
- [x] Submit reads verification commands from `validation.checks`.
- [x] All code paths and tests are updated to use `validation.checks` instead of top-level `checks`.
- [x] This repository's `.but-why/config.json` is migrated from top-level `checks` to `validation.checks`.
- [x] Init guidance may name `validation.prepare` and `validation.checks` as anchors, but does not teach config inline.
- [x] Init guidance says `.but-why/config.json` is tracked repo policy.
- [x] Init guidance tells agents to configure validation policy to the best of their ability based on observed repository tooling, while keeping the resulting `.but-why/config.json` explicit and reviewable.
- [x] Init guidance points agents to shipped public docs for examples and detail.
- [x] Init guidance is structured stdout that agents can parse.
- [x] Init guidance follows AXI contextual help rules.
- [x] `by init --help` mentions that init creates repo policy files and then guides validation setup.
- [x] Tests lock the init output shape for initialized, unchanged, and repaired states.
- [x] Submit tests cover `validation.checks` as the accepted checks location.
- [x] Submit tests cover top-level `checks` as rejected config.
- [x] `docs/public/config.md` documents `validation.checks` as the checks location and the expected post-init configuration flow.
- [x] Public setup docs mention configuring validation policy after init.

## Out of scope

- Long ecosystem-specific examples in default init output.
- Hidden dependency setup chosen by But Why.
- Interactive setup questions.
- Installing or publishing the `by` CLI.
- Choosing npm package name, registry credentials, provenance, or release workflow.
- Reviewer/profile policy unless current config parsing supports it.

## Blocked by

None.
