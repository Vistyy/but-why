# But Why setup

Run `by init --task-prefix <prefix>` once from the repository root after the `by` CLI is available.
The command is non-interactive.
It creates `.but-why/config.json`, `.but-why/state.sqlite`, `.but-why/reviewers/`, and managed ignore entries for local runtime state.

After init, configure validation policy in `.but-why/config.json`.
That file is tracked repo policy.
Inspect the repository tooling before choosing commands.
Configure `validation.prepare` and `validation.checks` to the best of your ability from observed tooling.
Keep the resulting config explicit and reviewable.

Use `config.md` in this directory for config fields and examples.
