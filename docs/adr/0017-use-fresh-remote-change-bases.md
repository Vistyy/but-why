# Use fresh remote Change Bases

But Why uses only a branch on the detected publication remote as a v1 Change Base because changed-code delivery targets an owned pull request and local branch state is not published intent.
Change Start fetches the remote default branch or a named `--base` branch before recording the Change, and the selected branch becomes the pull request target.
The Change records the publication remote URL so Submit rejects a remote name that is later redirected to another repository.
Change Submit first reconciles any existing owned pull request because an already merged or closed pull request takes precedence over current Change Base ancestry.
After reconciliation, an unchanged Repository Branch head that is already the exact passing Candidate confirmed on the owned pull request returns its stored success without fetching a newer Change Base.
Otherwise Submit begins a new Submission, fetches the recorded Change Base before Candidate capture, and requires the exact fetched Change Base commit to be an ancestor of the Repository Branch head.
Submit rejects before Candidate creation when the branch does not contain that commit and directs the Implementer to merge or rebase the Change Base.
That rejection creates no Candidate or Validation Run, changes no Task progress, and performs no publication mutation; authoritative pull request facts observed by earlier reconciliation remain recorded.
Submit does not modify the Managed Worktree or Repository Branch.

## Considered Options

But Why rejects local branches and local-only repositories as Change Base sources in v1.
A user who needs local commits in the Change Base must publish those commits before Change Start.
But Why also rejects using a stale remote-tracking ref without fetching because it can start or validate a Change against obsolete code.

## Consequences

A missing, ambiguous, unreachable, or incomplete publication remote rejects Change Start before Change or Task mutation.
A Submit-time refresh failure rejects Submission before Candidate or Validation Run creation.
Candidate identity includes the Change, exact fetched Change Base commit, and Repository Branch head commit.
`changeBaseSha` is the single canonical code, storage, and CLI name for that commit; `resolvedTargetSha` and `comparisonBaseSha` are retired.
When the Change Base commit changes, the existing Repository Branch cannot produce another Candidate until it contains that commit.
A completed Submission remains valid evidence for its recorded Change Base commit and is not invalidated automatically when the remote Change Base advances later.
Only a new Submission fetches a newer Change Base commit and requires the Repository Branch to contain it.
A repeated Submit command is an idempotent retry only when the unchanged Repository Branch head, passing Validation Run, and confirmed publication all identify the exact same Candidate; matching the head commit alone is insufficient.
Reconciliation may complete an owned pull request that merged after its recorded target advanced.
ADR 0011 continues to require locally owned pull request heads; this decision permits remote-only commits only on the Change Base.
