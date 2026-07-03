# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `023-replace-inline-task-state-unions-with-named-domain-type.md`
- `029-tighten-biome-and-typescript-quality-settings.md`
- `030-add-repo-documentation-and-local-state-checks.md`
- `031-add-fallow-codebase-health-reporting.md`

## Remaining dependency graph

```text
023 lifecycle language cleanup
  -> 024 opaque Task identity and safe slugs
    -> 025 TaskStore and RunStore split
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

029 tighten Biome and TypeScript quality settings
  -> 033 ast-grep structural bans

030 repo documentation and local-state checks

031 Fallow codebase health reporting
  -> 032 stable module boundaries with Fallow

024 opaque Task identity and safe slugs
  -> 033 ast-grep structural bans

025 TaskStore and RunStore split
  -> 032 stable module boundaries with Fallow

026 ValidationRuns.start seam
  -> 032 stable module boundaries with Fallow
```

## Notes

- Issues 023, 029, 030, and 031 can start now.
- Issue 032 should wait until Fallow exists and the store/start seams exist.
- Issue 033 should wait until stricter Biome/TypeScript settings exist and Task identity is opaque.
- Issue 028 fits after run inspection and before reviewer agents, because reviewer validation needs stable Task Context snapshots.
