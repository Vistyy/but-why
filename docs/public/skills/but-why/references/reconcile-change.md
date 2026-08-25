# Reconcile a Change

Use this procedure after a human confirms that the Change's owned pull request was merged.
Let `<but-why>` represent the command prefix resolved by the But Why command guidance.

Candidate Publication is not durable Change completion.
Close the Change's Interactive Session manually when one exists, then run `<but-why> change reconcile <change-id>`.
Reconciliation observes the exact owned pull request and merge facts before completing the Change and any linked Task, then performs terminal cleanup.

Use the complete structured result to determine whether reconciliation completed, remains pending, or was rejected.
When reconciliation reports unavailable merge facts, a remote mismatch, in-progress Submission, or pending cleanup, inspect the exact Change and follow only the returned recovery guidance.
Do not adopt an unrelated pull request or infer completion from a branch, commit, or human report alone.

`--discard-work` is destructive authority for one exact terminal Change and is not part of ordinary merged completion.
Use it only after the Operator explicitly authorizes discarding that Change's recorded work and the exact target has been verified.
If discard cleanup remains pending, retry only with the exact command returned by reconciliation.

This procedure is complete when reconciliation reports the exact Change completed with cleanup complete, or when its structured result identifies the pending evidence, cleanup, or decision that prevents completion.
