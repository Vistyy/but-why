# Freeze policy and make validation idempotent

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Give every Validation Run an immutable resolved policy snapshot and make repeated validation reuse the correct active or completed work.
Resolve automatic fixing from Repo Config and command overrides while keeping AFK behavior under Repo Config.
Changed immutable inputs create a new Validation Run under the same Change.

## Acceptance criteria

- [ ] Run creation stores an inspectable Validation Policy Snapshot and canonical fingerprint.
- [ ] Automatic fixing defaults to enabled, follows Repo Config, and supports an explicit command override.
- [ ] AFK work follows Repo Config without inheriting a manual command override.
- [ ] Two processes cannot create duplicate active runs for the same Change, Candidate, policy, and Acceptance Context.
- [ ] A repeated command reuses matching active work.
- [ ] Eligible completed evidence is reused without rerunning checks.
- [ ] Changed Candidate, policy, or Acceptance Context creates a new Validation Run.
- [ ] A newer head atomically supersedes active Candidate work while preserving stale runs for inspection.
- [ ] Results are accepted only when their Candidate and expected head remain current.
- [ ] A terminal operational failure can be retried without replacing the Change.
- [ ] Publication eligibility compares the current effective policy with the stored fingerprint.

## Blocked by

- `docs/issues/052-validate-candidate-checks-without-task.md`
