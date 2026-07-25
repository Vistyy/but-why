# Require a PR or accepted no-change completion

Every Task that changes the repository completes only when its exact validated Candidate is published through an owned PR and that PR merges.
When Submit proves that the Repository Branch head has the same tracked file tree as the exact fetched Change Base, Acceptance Review alone judges whether that current base already satisfies the approved intent.
Commit topology does not determine no-change when the final tracked trees are equal.
The original starting tree does not define no-change because the Change Base may advance before Submission.
A passing no-change review completes the Task without another command, caller reason, or PR.
That completion is terminal and idempotent; a later Change Base advancement does not reopen it, and repeated Submission returns the recorded completion without another ancestry check or review.
This supports legitimate no-change results without letting changed work bypass validation and human review.
