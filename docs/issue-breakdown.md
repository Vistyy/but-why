# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `045-make-finding-severity-optional-by-producer-contract.md`
- `044-package-by-as-installable-cli.md`

## Remaining dependency graph

```text
045 finding severity optional by producer contract
  -> 042 validation prepare phase
    -> 043 concise init validation guidance
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

044 package by as installable CLI
  -> 041 agent skill for by CLI
```

## Notes

- Issue 028 fits before reviewer agents, because reviewer validation needs stable Task Context snapshots.
- Issue 045 fits before prepare, because prepare depends on the command-produced Finding contract that makes severity optional.
- Issue 042 fits after checks and issue 045, because prepare is part of the validation execution path and uses the command-produced Finding contract.
- Issue 043 fits after prepare, because init guidance should point agents at the explicit validation config shape without carrying the full teaching burden.
- Issue 044 can start immediately, because packaging is independent from validation phases.
- Issue 041 fits after init validation guidance and installable CLI packaging, because agents need setup guidance and stable install/run instructions before using But Why? as part of their normal workflow.
