---
status: accepted
---

# Control Task progress through lifecycle operations

Task progress changes only through named operations with checked preconditions.
V1 uses Planning Review through Task Submission to create Task Approval, dependency-checked Change Start, validation and publication through Change Submission, synchronous Task cancellation, and authoritative merge or accepted No-Change completion.
Task Approval belongs to the exact reviewed Task proposal, planning policy, and Planning Base instead of remaining permanent after those facts change.
An operator must explicitly confirm an approved Task revision before the Task returns to New for another Task Submission.
A generic state-setting command is not supported.
A repeated Task Submission or Change Submission may recover interrupted progress only through valid lifecycle transitions and exact durable evidence.
This keeps Task progress derived from approved intent, repository state, validation, and pull-request facts.
