# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `013-inspect-runs-and-latest-task-findings.md`

## Remaining dependency graph

```text
013 inspection commands
  -> 041 agent skill for by CLI
  -> 028 Validation Run Task Context snapshots
    -> 039 config and reviewer Schema contracts
      -> 014 intent reviewer
        -> 015 quality reviewers
          -> 016 publish PR
            -> 040 Effect-scheduled GitHub polling
              -> 017 watch PR
                -> 019 reconcile
                  -> 020 daemon
        -> 018 token summaries
        -> 021 reviewer evals
```

## Notes

- Issue 028 fits after Validation Run inspection and before reviewer agents, because reviewer validation needs stable Task Context snapshots.
- Issue 041 fits after inspection commands, because agents need a supported way to read Findings and Validation Run details before using But Why? as part of their normal workflow.
