# Keep v1 PR heads locally owned

V1 supports one local Change, one But Why-owned branch, and one PR whose head is published only from an exact validated local Candidate.
An unexpected remote head, repository, or base fact produces a typed reconciliation error and is never adopted automatically.
This keeps publication and reconciliation safe without making manual v1 depend on forks, remote-only commits, or unclear branch authority.
