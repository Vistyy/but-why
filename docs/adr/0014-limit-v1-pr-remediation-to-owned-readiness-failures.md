# Limit v1 PR remediation to owned readiness failures

V1 PR remediation is opt-in and may write code only for a failed GitHub-required check or confirmed merge conflict on the exact PR, repository, head branch, base target, and expected Candidate SHA durably owned by one Change.
PR comments, review comments, review bodies, titles, descriptions, labels, and requested-change text never become Fixer instructions, while But Why? code records Needs Input when GitHub reports an active requested-changes review.
A PR Fixer receives only bounded failed-CI diagnostics or repository merge facts, makes and records its own implementation decisions, and cannot approve, merge, request Needs Input, or change lifecycle state.
But Why? code records Needs Input only after it observes ownership drift, no successor Candidate, a Sensitive Change under fixed policy, an ambiguous remote result, or an exhausted limit with no approved automatic recovery.
