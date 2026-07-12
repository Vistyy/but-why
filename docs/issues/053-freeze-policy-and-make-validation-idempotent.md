# Freeze policy and make validation idempotent

## Parent

`docs/prds/change-centered-validation-prd.md`

## What to build

Move Validation Run ownership to the Candidate, give every run an immutable resolved policy snapshot, and make repeated validation reuse the correct active or completed work.
Resolve automatic fixing separately from validation policy, using Repo Config and command overrides while keeping AFK behavior under Repo Config.
Changed immutable validation inputs create a new Validation Run under the same Change, while changing automatic fixing reuses the same validation evidence.

## Acceptance criteria

- [ ] Every new Validation Run belongs to a Candidate and has a permanent UUID independent of any Task.
- [ ] Run creation accepts an optional versioned Acceptance Context snapshot without requiring a Task and stores its canonical fingerprint.
- [ ] Missing Acceptance Context skips later Acceptance Review, while empty Acceptance Context is rejected.
- [ ] The existing Task-backed submit path captures a Candidate and creates a Candidate-owned Validation Run while keeping Task behavior outside validation.
- [ ] Run creation stores an inspectable Validation Policy Snapshot containing the resolved prepare and ordered check commands, timeouts, reviewers, instruction contents, agent settings, sandbox settings, applied defaults, and snapshot schema version.
- [ ] The snapshot fingerprint is SHA-256 over its versioned canonical JSON and does not depend on config formatting or instruction file paths.
- [ ] Automatic fixing defaults to enabled, follows Repo Config, and supports an explicit command override without changing the Validation Policy Snapshot or fingerprint.
- [ ] Changing automatic fixing reuses matching validation evidence.
- [ ] AFK work follows Repo Config without inheriting a manual command override.
- [ ] Each validation request captures the current Candidate and resolves the current policy, Acceptance Context, and configured copied-file hashes before selecting a run.
- [ ] If those immutable inputs match, the request reuses active work, passed evidence, or Findings; a tooling-failed run creates a retry run.
- [ ] If immutable inputs differ, the same transaction supersedes an active run and creates a new one.
- [ ] Two processes cannot create duplicate active runs for the same Candidate and matching immutable inputs.
- [ ] Validation Run State is `active`, `complete`, or `superseded`; a complete run has the outcome `passed`, `blocked`, or `tooling_failed`.
- [ ] One process advances an active run under a Validation Run Lease renewed every 15 seconds and expiring after 60 seconds; another process cannot duplicate that execution.
- [ ] An expired lease ends the run with a Validation Tooling Failure, rejects late writes from the expired lease, and allows a new retry run for the same Candidate.
- [ ] Passed phase evidence is reused only for the same Candidate and matching immutable inputs, such as after a later tooling failure.
- [ ] Matching Findings are reused for an unchanged Candidate; changing automatic fixing may send those existing Findings to a fixer without rerunning validation.
- [ ] A successor Candidate reruns prepare and every configured check while preserving the earlier Candidate's Findings as history.
- [ ] Run creation records the paths and content hashes of files explicitly copied by `validationWorkspace.copyFiles` without storing their contents in the policy snapshot.
- [ ] Each Change records its Current Candidate and Current Validation Run.
- [ ] A validation request atomically reuses the matching Current Validation Run or replaces it; replacement supersedes an active old run but leaves a complete old run unchanged as history.
- [ ] Capturing a newer Candidate or requesting validation with changed immutable inputs marks the previous active run as superseded and stops its execution while preserving recorded evidence.
- [ ] Late result evidence for a superseded run remains inspectable but cannot advance the Change's current validation state.
- [ ] A terminal operational failure can be retried in a new Validation Run without replacing the Change.
- [ ] A retry may reuse fully passed phases with matching immutable inputs, but it reruns every producer in an incomplete phase.
- [ ] Issue 053 exposes comparison between current immutable inputs and stored fingerprints without deciding full-gate completion or publishing.
- [ ] Issue 059 decides full Validation Gate completion, and Issue 061 enforces current eligibility during publication.

## Blocked by

- `docs/issues/050-expand-storage-with-change-and-candidate.md`
- `docs/issues/051-add-automatic-change-and-candidate-capture.md`
