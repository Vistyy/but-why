# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `027-represent-validation-run-separately-from-run.md`

## Remaining dependency graph

```text
027 separate Validation Run from generic Run
  -> 037 validation Effect error taxonomy
    -> 038 scoped Validation Workspace lifecycle
      -> 012 checks and check Findings
        -> 013 inspection commands
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

- Issue 028 fits after run inspection and before reviewer agents, because reviewer validation needs stable Task Context snapshots.
