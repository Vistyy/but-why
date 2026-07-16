# Require a PR or accepted no-change completion

Every Task that changes the repository completes only when its exact validated Candidate is published through an owned PR and that PR merges.
When Submit proves that the current tracked tree matches the Task's recorded starting tree, Acceptance Review alone judges whether the existing repository already satisfies the approved intent.
A passing no-change review completes the Task without another command, caller reason, or PR.
This supports legitimate no-change results without letting changed work bypass validation and human review.
