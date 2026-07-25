---
status: accepted
---

# Control Task progress through lifecycle operations

Task progress changes only through named operations with checked preconditions.
V1 uses permanent Task Approval, dependency-checked Change Start, validation and publication through Change Submit, synchronous Task cancellation, and authoritative merge or accepted No-Change completion.
A generic state-setting command is not supported.
A repeated Submission may recover interrupted Task progress through valid lifecycle transitions only when durable validation and publication evidence belong to the exact same Candidate.
This keeps Task progress derived from durable intent, Git, validation, and PR facts while allowing later workflows to add explicit operations when evidence requires them.
