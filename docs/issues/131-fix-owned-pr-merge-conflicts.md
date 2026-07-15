# Fix merge conflicts on an owned PR

## Specification

- `docs/prds/change-centered-validation-prd.md`
- `CONTEXT.md`
- `docs/adr/0011-keep-v1-pr-heads-locally-owned.md`
- `docs/adr/0014-limit-v1-pr-remediation-to-owned-readiness-failures.md`
- `docs/adr/0015-harden-sandcastle-containers-for-v1-automatic-writing.md`

## Behaviors owned

- An explicitly enabled PR Readiness Fixer addresses a confirmed conflict between an exact owned PR head and the current expected base branch.
- The merge operation uses repository facts rather than GitHub comments or review text.
- The resolved successor Candidate must pass the complete local gate before expected-SHA push.

## What to build

Add one safe base-update and conflict-resolution path for owned PRs through the hardened PR Fixer boundary.
Preserve both pre-resolution SHAs and reject any concurrent remote movement.

## Primary verification seam

Temporary remote repository test with a real merge conflict and fake Pi.

## Acceptance criteria

- [ ] PR Fixer is explicitly enabled and exact PR ownership is reverified before conflict work.
- [ ] GitHub must report a confirmed conflict rather than unknown or pending mergeability.
- [ ] But Why fetches and records the exact current base tip without changing the existing Candidate.
- [ ] Conflict resolution merges that base tip into the owned PR branch without rebasing or rewriting existing commits.
- [ ] The resolution produces one merge commit whose two parent SHAs match the recorded PR head and base tip.
- [ ] Pi receives the owned Candidate, exact base tip, conflict files, and fixed minimal-resolution instructions without GitHub free-form text.
- [ ] Pi runs through the hardened automatic-writing sandbox with no GitHub credentials or push ability.
- [ ] The chosen Git integration preserves recoverable pre-resolution head and base facts.
- [ ] The Fixer makes and records its decisions and attempts the complete conflict resolution without requesting Needs Input.
- [ ] But Why? code records Needs Input only after it verifies no clean successor Candidate, an unresolved conflict, a Sensitive Change under fixed policy, or an exhausted budget with no approved automatic recovery.
- [ ] A clean conflict resolution becomes a successor Candidate and runs the complete local Validation Gate.
- [ ] But Why rechecks PR identity, base target, base tip policy, and remote head before compare-and-swap push.
- [ ] But Why? code records Needs Input without overwrite when trusted remote facts show concurrent head movement, retargeting, or an ambiguous push result after recovery.
- [ ] The Fixer never approves or merges the PR.

## Open decisions to grill

- Merge commit message and authorship policy.
- Base movement during fixing and validation.
- Conflict size and binary-file limits.
- Exact Sensitive Change classifier and no-successor behavior for conflict-only metadata.

## Blocked by

- `docs/issues/095-complete-final-review.md`
- `docs/issues/100-compose-standalone-validation-and-publication.md`
- `docs/issues/101-reconcile-one-owned-pr-once.md`
- `docs/issues/130-harden-automatic-code-writing-sandbox.md`
