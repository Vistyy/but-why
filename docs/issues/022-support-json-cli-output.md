# Support JSON CLI output

## Status

Done.

## Parent

`docs/adr/0003-support-json-for-programmatic-cli-consumers.md`

## What to build

Add JSON as a supported stdout format for programmatic CLI consumers while keeping TOON as the default AXI-style agent format.

Users select stdout format with the global CLI option `--output <format>` or `-o <format>`.
Because this is a global option, callers may place it before or after the command.
The only valid output formats are lowercase `toon` and `json`.
TOON is selected by default and can also be selected explicitly with `--output toon` or `-o toon`.
JSON is selected with `--output json` or `-o json`.
Invalid `--output` values and missing output values are structured usage errors with exit code 2, emitted in the default TOON format because no valid serializer was selected.
Invalid output format errors use stable `error.code: invalid_output_format`.
Duplicate output selectors are structured usage errors with exit code 2, even when both selectors use the same value.
Duplicate output selector errors use stable `error.code: duplicate_output_selector` and are emitted in the default TOON format because output selection is invalid as a whole.
When exactly one valid output selector is present, later usage errors and command failures use the selected serializer.

Command handlers should continue to return structured result objects before serialization.
JSON stdout should serialize those command result objects directly, without adding a versioned envelope in v1.
JSON stdout should be compact single-line JSON by default with a trailing newline.

Serialization choice belongs at the CLI output boundary.

Domain modules must not depend on TOON or JSON.

## Acceptance criteria

- [x] CLI commands support selecting stdout output with `--output <format>` and `-o <format>` before or after the command.
- [x] Valid output formats are only lowercase `toon` and `json`.
- [x] TOON remains the default stdout output format and can be selected explicitly with `--output toon` and `-o toon`.
- [x] JSON stdout output can be selected with `--output json` and `-o json`.
- [x] JSON output uses the same structured result objects as TOON output, without a versioned envelope in v1.
- [x] JSON output is compact single-line JSON with a trailing newline.
- [x] Structured errors are emitted as JSON when `--output json` or `-o json` is selected and the output selector itself is valid.
- [x] Structured errors include required stable `error.code` and `error.message` fields.
- [x] Other error fields, such as `help`, `details`, or `valid`, are optional.
- [x] Error codes are stable snake_case strings.
- [x] Invalid `--output` values and missing output values are emitted as structured TOON usage errors with `error.code: invalid_output_format` and exit with code 2.
- [x] Duplicate output selectors are emitted as structured TOON usage errors with `error.code: duplicate_output_selector` and exit with code 2.
- [x] Usage errors after exactly one valid output selector use the selected serializer and exit with code 2.
- [x] Command failures after exactly one valid output selector use the selected serializer and exit with code 1 unless a more specific exit code is documented.
- [x] Structured success and structured errors go to stdout.
- [x] Progress and diagnostics remain on stderr.
- [x] Help output documents `--output <format>`, `-o <format>`, default `toon`, and valid values `toon` and `json`.
- [x] Task lifecycle modules do not import or depend on TOON or JSON serializers.
- [x] CLI tests cover default TOON success, explicit TOON success, JSON success, JSON structured command error, JSON structured usage error after a valid selector, invalid selector TOON usage error, missing selector value TOON usage error, duplicate selector TOON usage error, and selector placement before and after the command.

