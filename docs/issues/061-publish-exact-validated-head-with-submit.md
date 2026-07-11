# Publish an exact validated head with by submit

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Compose `by submit` from Change discovery, validation, fixing, PR writing, and exact-head publication.
The command reuses eligible evidence and creates or updates one durable PR only after the current Change head is proven eligible.

## Acceptance criteria

- [ ] `by submit` uses Issue 051's shared capability to automatically resolve the Change and capture or reuse the current Candidate without requiring a Task.
- [ ] Eligible validation evidence is reused, while missing or stale evidence enters the normal validation and fixing flow.
- [ ] GitHub target discovery happens only when publication is needed.
- [ ] A fresh read-only PR Writer uses final code, eligible evidence, optional Acceptance Context, and filtered Implementation Decisions.
- [ ] PR Writer output and failures are durable and cannot modify or validate the Change.
- [ ] Publication atomically verifies that the Change head equals the eligible Candidate head.
- [ ] PR identity is persisted and remote-success recovery cannot create a duplicate PR.
- [ ] PR Writer and publication retries are bounded and preserve validated state when exhausted.
- [ ] Repeated submission of an already published Candidate returns the existing PR.
- [ ] `by validate` remains local and never invokes publication.

## Blocked by

- `docs/issues/053-freeze-policy-and-make-validation-idempotent.md`
- `docs/issues/059-add-final-gates-and-expose-validate.md`
- `docs/issues/060-add-change-owned-needs-input-and-resume.md`
