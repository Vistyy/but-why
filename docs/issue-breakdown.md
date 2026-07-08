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
  -> 042 validation prepare phase
    -> 043 init validation configuration guidance
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
- Issue 042 fits after checks, because prepare is part of the validation execution path.
- Issue 043 fits after prepare, because init guidance should teach agents the final explicit validation config shape.
- Issue 041 fits after inspection commands and init validation guidance, because agents need a supported way to read Findings and configure validation before using But Why? as part of their normal workflow.
