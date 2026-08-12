---
status: accepted
---

# Control Task progress through lifecycle operations

Task progress changes only through named operations with checked preconditions.
V1 uses Task Submission with a passing Task Review as the sole path from New to Todo, dependency-checked Change Start, validation and publication through Change Submission, synchronous Task cancellation, and authoritative exact merged-Candidate completion.
A generic state-setting command is not supported.
Task Submission does not start a Change, authorize implementation, or schedule implementation.
A repeated Change Submission may recover interrupted progress only through valid lifecycle transitions and exact durable evidence.
This keeps Task progress derived from approved intent, repository state, validation, and pull-request facts.
