# Keep the Supervisor infrastructure-only

The v1 Supervisor owns repository registration, durable wakes, worker process lifecycle, and worker health without becoming an agent or reading repository workflow state.
Later vertical slices may add targeted dispatch, bounded fleet reporting, a terminal UI, and a Coordinator Agent as clients of versioned Supervisor and repository-worker interfaces.
This preserves durable But Why? records as the source of truth while allowing a FirstMate-like user experience to grow without embedding workflow reasoning in terminal sessions or the process supervisor.
