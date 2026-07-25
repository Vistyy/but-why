---
status: accepted
---

# Keep completed Submissions stable

Configuration changes apply to future or unfinished Submissions but do not invalidate completed Submissions, Candidates, or historical Validation Runs.
Each Validation Run retains its immutable Validation Policy Snapshot, while a retry of unfinished work resolves current configuration and may create another Validation Run.
A Candidate that already has passing validation and confirmed publication remains complete without silently rerunning validation under later configuration.
When the Repository Branch head is unchanged, a repeated Submit command returns that stored success without fetching a later Change Base.

## Considered Options

- Invalidate completed evidence whenever effective Repo Config or Global Config changes.
- Treat all retries as continuations under an older policy regardless of completion state.
- Preserve completed evidence while applying current configuration to future or unfinished Submissions.

## Consequences

Ready Tasks and completed No-Change Submissions do not reopen when configuration changes.
Historical Validation Runs remain auditable under the exact policy they used.
Requesting another validation of an already completed Candidate requires a separate explicit capability rather than overloading idempotent Submit.
