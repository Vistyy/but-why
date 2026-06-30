# Support JSON CLI output

## Parent

`docs/adr/0003-support-json-for-programmatic-cli-consumers.md`

## What to build

Add JSON as a supported stdout format for programmatic CLI consumers while keeping TOON as the default AXI-style agent format.

Command handlers should continue to return structured result objects before serialization.

Serialization choice belongs at the CLI output boundary.

Domain modules must not depend on TOON or JSON.

## Acceptance criteria

- [ ] CLI commands support selecting JSON stdout output.
- [ ] TOON remains the default stdout output format.
- [ ] JSON output uses the same structured result objects as TOON output.
- [ ] Structured errors can be emitted as JSON when JSON output is selected.
- [ ] Progress and diagnostics remain on stderr.
- [ ] Task lifecycle modules do not import or depend on TOON or JSON serializers.
- [ ] CLI tests cover TOON default output and JSON selected output for success and structured error cases.

## Blocked by

- 007-deepen-task-architecture-seams.md
