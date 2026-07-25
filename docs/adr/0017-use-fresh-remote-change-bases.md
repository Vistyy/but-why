# Use fresh remote Change Bases

But Why uses only a branch on the detected publication remote as a v1 Change Base because changed-code delivery targets an owned pull request and local branch state is not published intent.
Change Start fetches the remote default branch or a named `--base` branch before recording the Change, and the selected branch becomes the pull request target.
Change Submit fetches that recorded branch before Candidate capture so Candidate identity and validation include the current target commit without modifying the Managed Worktree or Repository Branch.

## Considered Options

But Why rejects local branches and local-only repositories as Change Base sources in v1.
A user who needs local commits in the Change Base must publish those commits before Change Start.
But Why also rejects using a stale remote-tracking ref without fetching because it can start or validate a Change against obsolete code.

## Consequences

A missing, ambiguous, unreachable, or incomplete publication remote rejects Change Start before Change or Task mutation.
A Submit-time refresh failure rejects Submission before Candidate or Validation Run creation.
When the target commit changes, But Why records a new Candidate and cannot reuse validation for the older target.
ADR 0011 continues to require locally owned pull request heads; this decision permits remote-only commits only on the Change Base.
