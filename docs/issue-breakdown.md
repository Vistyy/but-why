# Issue Dependency Graph

This file tracks remaining issue ordering only.

Detailed issue bodies live under `docs/issues/`.

Parent PRDs live under `docs/prds/`.

Done issues are omitted from this graph.

## Can start immediately

- `041-add-agent-skill-for-by-cli.md`
- `046-publish-by-to-npm-registry.md`

## Remaining dependency graph

```text
041 agent skill for by CLI
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

046 publish by to npm registry
```

## Notes

- Issue 041 can start now that init validation guidance and installable CLI packaging are done.
- Issue 046 can start now that installable CLI packaging is done.
