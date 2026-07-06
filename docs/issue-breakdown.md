# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `025-split-taskstore-from-runstore-with-sqlite.md`
- `033-add-ast-grep-structural-bans.md`

## Remaining dependency graph

```text
025 TaskStore and RunStore split
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

025 TaskStore and RunStore split
  -> 032 stable module boundaries with Fallow

026 ValidationRuns.start seam
  -> 032 stable module boundaries with Fallow
```

## Notes

- Issue 025 can start now because Task identity is opaque.
- Issue 033 can start now because stricter Biome/TypeScript settings exist and Task identity is opaque.
- Issue 032 should wait until the store/start seams exist.
- Issue 028 fits after run inspection and before reviewer agents, because reviewer validation needs stable Task Context snapshots.
