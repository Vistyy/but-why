# Interactive Session

Use this procedure when pausing, continuing, or monitoring an Implementer Interactive Session.
Change Implement sessions load the packaged `continue-change` extension automatically.
Do not add it to an Agent Profile.

While the bound Change has an active Implementation Blocker, the extension checks for an approved Resolution every 30 seconds.
Inspections do not overlap.
When the extension finds a new Resolution in an unpaused session, it explains the Resolution and automatically resumes the Implementer once for that Resolution.
It explains the Resolution before it directs the Implementer to Findings from an earlier Validation Run.
Polling stops when the Change is no longer blocked or is closed.
A terminal Change does not wake the Implementer.

Use `/pause-change` before discussing a Change with the Implementer, investigating an active blocker, recording a Resolution, or taking an external action.
Pause overrides an inspection that is already in progress.
A Resolution recorded while paused remains pending.

Use `/continue-change` to unpause, refresh the Change state, and continue the bound Change when continuation is safe.
Repeated `/continue-change` commands keep continuation unpaused.
A pending Resolution is handled when the Operator explicitly continues or when the Interactive Session starts unpaused.
If automatic continuation is unavailable, tell the Implementer to continue after recording the Resolution.

If inspection fails, `/continue-change` retries the local inspection and reports the recovery action.
A Validation Tooling Failure receives recovery guidance only after the Operator runs `/continue-change`.

The continuation widget reports when the Change is blocked, implementing a revision, validating a revision, or waiting for human review.
When a publication has a pull request URL, the widget includes that URL while waiting for human review and during later revision implementation or validation.
Automatic continuation waits while the exact current Candidate remains published.
Under the Operator's direct instruction, `/continue-change` resumes revision work for a published Change.

This procedure is complete when the extension is in the state required for the Operator's next action.
