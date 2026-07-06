# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `034-split-task-cli-edge-modules.md`

## Remaining dependency graph

```text
034 split task CLI edge modules
  -> 026 ValidationRuns.start seam
    -> 027 separate Validation Run from generic Run
      -> 012 checks and check Findings
        -> 013 inspection commands
          -> 028 Validation Run Task Context snapshots
            -> 014 intent reviewer
              -> 015 quality reviewers
                -> 016 publish PR
                  -> 017 watch PR
                    -> 019 reconcile
                      -> 020 daemon
              -> 018 token summaries
              -> 021 reviewer evals

026 ValidationRuns.start seam
  -> 032 stable module boundaries with Fallow
```

## Notes

- Issue 034 can start now because `TaskUseCases` exists after issue 025.
- Issue 026 should follow issue 034 so task CLI edge complexity is reduced before validation-start patterns spread.
- Issue 032 should wait until the task CLI split and ValidationRuns seam exist.
- Issue 028 fits after run inspection and before reviewer agents, because reviewer validation needs stable Task Context snapshots.
