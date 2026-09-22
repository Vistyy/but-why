# But Why

But Why runs focused code-review rules with independent Pi agents. It is not a test runner, a CI gate, or a judge of whether a change is acceptable. Reviewers return prose; the caller decides what to do with it.

## Run a review

Install the package with Node.js 24 and invoke `by` from a Git repository:

```sh
by review change --base <full-commit-sha> --head <full-commit-sha>
by review files --at <full-commit-sha> src/example.ts src/other.ts
by review repository --at <full-commit-sha>
```

Only committed revisions are supported. `change` reviews the direct difference between the two commits and may inspect related code. Large diffs are explicitly truncated in the review context rather than rejected. `files` reviews the named regular files and related code; `repository` gives the reviewer the whole repository as its scope. A reviewer's observations are not guaranteed to exhaust that scope.

Set a default model and thinking level in `<Pi agent directory>/but-why/config.json` (normally `~/.pi/agent/but-why/config.json`; follows `PI_CODING_AGENT_DIR`):

```json
{ "model": "provider/model-id", "thinkingLevel": "high" }
```

Any review command can add `--model provider/model-id` and/or `--thinking-level high` to override those defaults. The model identifier must match Pi's catalog with configured authentication. If neither the config nor the command supplies a model, the review fails; it never silently chooses another one. Thinking level defaults to `medium`; Pi supports `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, and clamps unsupported choices to a level the model can use. The JSON result records the requested level and, once the model resolves, the effective level.

To use a Pi extension in reviewers, list it in the same **user** config file:

```json
{
  "model": "provider/model-id",
  "thinkingLevel": "high",
  "extensions": ["/absolute/path/to/extension/index.ts", "npm:example-extension@1.0.0"]
}
```

Entries can be absolute local paths or Pi package references such as `npm:…` and `git:…`; Pi resolves the packages as it does for temporary `-e` extensions. Unlisted global extensions and extensions from the reviewed repository do not load. No package skills, prompts, themes, or `AGENTS.md` are supplied to reviewers. Pi auto-compaction is enabled, so a configured remote-compaction extension can handle a review that reaches Pi's context threshold. **Listed extensions are trusted code with full process permissions**: they can alter prompts, tools, or files; this opt-in is not a sandbox.

Each run creates one detached checkout at the reviewed commit. All selected rules run in separate Pi sessions against that checkout, with up to three reviewers at once by default. Every review command accepts `--concurrency N` (a positive integer) to change that limit for one run. Reviewers have only Pi's `read` and `bash` tools; bash can search, list files, and run focused probes. They are instructed not to edit files or run a full test suite. This is **cooperative, not a sandbox**. But Why checks the checkout before and after review, including ignored files. It removes the checkout only when it can prove it remains clean, and reports the preserved path if cleanup is unsafe.

## Rules

One Markdown file is one rule. But Why ships no rules yet.

- Global: `<Pi agent directory>/but-why/rules/*.md` (normally `~/.pi/agent/but-why/rules/`; follows `PI_CODING_AGENT_DIR`).

- Project: `.but-why/rules/*.md`, read from the **base commit** for `change` or the audited commit for `files` and `repository`. Changing a rule in the proposed head cannot weaken a change review of that head.

Rules are additive. Filenames identify them as `global/<name>` or `project/<name>`; the same name in both locations runs twice. With no rules, the command fails rather than claiming a review occurred.

But Why supplies its own reviewer instructions and inspection tools. It does not load the reviewed repository's Pi extensions, skills, prompts, or `AGENTS.md` as reviewer instructions. Rule text is trusted configuration; repository source is review evidence, not an instruction channel.

## Results

`by` writes one JSON result to stdout with the exact revisions, chosen model, requested and effective thinking levels, concurrency limit, scope, rule provenance and content digest, and each reviewer's **unedited** final prose or mechanical failure. It makes no semantic pass/fail decision. If a reviewer fails or times out, the other running reviewers finish. If a timed-out reviewer has not settled after a bounded grace period, further queued reviews are skipped and the checkout is preserved. Reports remain in a result marked `incomplete`, and the command exits nonzero. Git, checkout-integrity, and cleanup failures also produce a nonzero incomplete result. There is no automatic retry or fix loop.

To develop But Why itself, see `AGENTS.md` and `VERIFICATION.md`.
