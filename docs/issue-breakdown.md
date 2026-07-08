# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `043-guide-init-validation-configuration.md`
- `044-package-by-as-installable-cli.md`

## Remaining dependency graph

```text
043 concise init validation guidance
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
  -> 046 publish by to npm registry
```

## Notes

- Issue 043 can start now that prepare is done, because init guidance should point agents at the explicit validation config shape without carrying the full teaching burden.
- Issue 044 can start immediately, because packaging is independent from validation phases.
- Issue 041 fits after init validation guidance and installable CLI packaging, because agents need setup guidance and stable install/run instructions before using But Why? as part of their normal workflow.
- Issue 046 fits after installable CLI packaging, because registry publishing depends on the package being publish-ready first.
