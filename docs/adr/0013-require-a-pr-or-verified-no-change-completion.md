# Require a PR or verified no-change completion

Every Task that changes the repository completes only when its exact validated Candidate is published through an owned PR and that PR merges.
An approved Task may instead complete through `by task complete` with a required reason only after But Why? fences active work and proves that its managed Change has no owned PR, no repository diff from its recorded base, and no staged, unstaged, or untracked work.
This supports investigations that correctly require no change without introducing a second result model or allowing changed work to bypass review.
