# Fix failed GitHub CI on an owned PR

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0009-keep-needs-input-an-orchestration-owned-circuit-breaker.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`
- `docs/adr/0014-limit-v1-pr-remediation-to-owned-readiness-failures.md`
- `docs/adr/0015-harden-sandcastle-containers-for-v1-automatic-writing.md`

## Behaviors owned

- An explicitly enabled PR Readiness Fixer addresses failed GitHub-required checks on one exact owned PR head.
- CI diagnostics are bounded untrusted data and never become Task intent.
- Pi has no GitHub credential or push ability.
- But Why validates and pushes the successor Candidate through expected-SHA compare-and-swap.

## What to build

After all required checks settle, collect every failed required check for the exact published Candidate and run one hardened PR Fixer execution.
Keep free-form PR and review content outside the Fixer input.

## Primary verification seam

Adversarial fake GitHub and Pi CI-fixing test.

## Acceptance criteria

- [ ] PR Fixer is disabled unless Repo Config explicitly enables it.
- [ ] Repository, PR, head repository, head branch, base repository, base target, and expected head SHA are re-read and match durable ownership before execution.
- [ ] Only failed GitHub-required checks for the exact head trigger the Fixer.
- [ ] Every failed required check enters one PR CI Fixer batch after pending required checks settle.
- [ ] Diagnostics are fetched only for that head, bounded, marked untrusted, and kept separate from fixed instructions and Task Context.
- [ ] PR comments, review text, title, description, labels, branch names, and commit messages are absent from Fixer instructions.
- [ ] Pi runs through the hardened automatic-writing sandbox with no GitHub credentials or push tool.
- [ ] The Fixer makes and records its decisions and attempts the complete diagnostic batch without requesting Needs Input.
- [ ] But Why? code records Needs Input only after it verifies no successor Candidate, a Sensitive Change under fixed policy, ownership drift, ambiguous remote state, or an exhausted budget with no approved automatic recovery.
- [ ] A clean successor Candidate runs the complete local Validation Gate.
- [ ] Before push, But Why rechecks the exact remote head and refuses any mismatch.
- [ ] But Why performs the remote update through compare-and-swap and confirms the resulting PR head.
- [ ] The PR Fixer never approves or merges.

## Open decisions to grill

- Trusted check identity and failed-log retrieval rules.
- Diagnostic byte limit and redaction pipeline.
- Built-in Sensitive Change path and content policy.
- Exact compare-and-swap Git operation and retry limit.

## Blocked by

- `docs/issues/095-complete-final-review.md`
- `docs/issues/100-compose-standalone-validation-and-publication.md`
- `docs/issues/101-reconcile-one-owned-pr-once.md`
- `docs/issues/130-harden-automatic-code-writing-sandbox.md`
