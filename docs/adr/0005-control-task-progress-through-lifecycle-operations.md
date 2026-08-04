---
status: accepted
---

# Control Task progress through lifecycle operations

Task progress changes only through named operations with checked preconditions.
V1 uses explicit Task Approval, dependency-checked Change Start, validation and publication through Change Submission, synchronous Task cancellation, and authoritative exact merged-Candidate completion.
A generic state-setting command is not supported.
A repeated Change Submission may recover interrupted progress only through valid lifecycle transitions and exact durable evidence.
This keeps Task progress derived from approved intent, repository state, validation, and pull-request facts.
