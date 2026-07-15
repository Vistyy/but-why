# Control Task progress through lifecycle operations

Task progress changes only through named lifecycle operations with checked preconditions: permanent Approval, Start, Hold, Resume, Cancel, PR reconciliation, and verified no-change completion.
Hold is a visible temporary Task state that remembers the interrupted stage, fences active work, and resumes from the last durable checkpoint with fresh processes, while Cancel is terminal and a generic state-setting command is not supported.
When Hold cannot confirm remote PR protection, the local Hold remains effective, reports the uncertainty, and retries best effort while an externally observed merge remains authoritative.
This keeps Task state, Change evidence, and dependency satisfaction trustworthy while allowing future workflows to add explicit paths with their own proof.
