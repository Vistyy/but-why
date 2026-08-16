# But Why Context Map

## Contexts

- [Task Intent](./docs/context/task-intent/CONTEXT.md) - owns requested intent, Task Submission, dependencies, and user-facing Task progress.
- [Change Delivery](./docs/context/change-delivery/CONTEXT.md) - owns code lineage, implementation, Candidate selection, validation, publication, reconciliation, and Change completion.
- [Repository Runtime](./docs/context/repository-runtime/CONTEXT.md) - owns repository identity, shared operational state, configuration, executable selection, preparation, and agent runtime configuration.

Task/Change coordination is the application boundary for the optional one-to-one link between Task Intent and Change Delivery.
It owns linked Change Start, joined inspection, coordinated cancellation, and exact merged completion.

## Relationships

- **Task Intent -> Task/Change coordination -> Change Delivery**: An approved Task can start one linked Change, which captures its initial Acceptance Context.
- **Change Delivery -> Task/Change coordination -> Task Intent**: Exact merged Change evidence can complete the linked Task, while Change cancellation can cancel it.
- **Repository Runtime -> Task/Change coordination**: Shared Repository State supplies atomic transaction capability and persists the correlation link.
- **Repository Runtime -> Task Intent**: Shared Repository State persists Tasks.
- **Repository Runtime -> Change Delivery**: Shared Repository State persists Changes and validation evidence, while resolved configuration supplies preparation, validation, reviewer, and Interactive Session behavior.
