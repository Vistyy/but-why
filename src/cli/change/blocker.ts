// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import type { CliResult } from "../../cliResults.js";
import { loadChangeInspection } from "../../change/loadChangeInspection.js";
import { readRecordingText, type RecordingTextReadError } from "../../cli/input/recordingText.js";
import { runtimeError, success, usageError } from "../../cliResults.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";
import * as support from "./changeSupport.js";

type ChangeBlockerCommand =
  | { readonly action: "list"; readonly changeId: string }
  | { readonly action: "raise" | "resolve"; readonly changeId: string; readonly file: string };

export const runBlocker = (
  command: ChangeBlockerCommand,
  environment: ChangeCommandEnvironment,
): Effect.Effect<CliResult> => {
  const action = command.action;
  const changeId = command.changeId;
  if (action === "list") {
    const loaded = loadChangeInspection({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.inspection.blockers(changeId).pipe(
      Effect.map((history) =>
        history === undefined ? support.changeNotFound() : success({ changeId, ...history }),
      ),
      support.inspectionFailure,
    );
  }
  const content = readRecordingText(environment.cwd, command.file, environment.stdin);
  if (!content.ok) return Effect.succeed(blockerInputError(content.error));
  const loaded = loadChangeInspection({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
  const operation =
    action === "raise" ? loaded.inspection.raiseBlocker : loaded.inspection.resolveBlocker;
  return operation({
    changeId,
    content: content.content,
    now: environment.now().toISOString(),
  }).pipe(
    Effect.map((result) =>
      result.ok
        ? success({ changeId, blocker: result.blocker, change: result.change })
        : runtimeError({
            code: result.code,
            message: `Cannot ${action} an Implementation Blocker in this Change.`,
            details: { changeId },
            help: ["Inspect the Change and use the applicable blocker lifecycle command."],
          }),
    ),
    support.inspectionFailure,
  );
};

const blockerInputError = (error: RecordingTextReadError): CliResult => {
  switch (error.code) {
    case "recording_text_file_not_found":
      return usageError({
        code: "blocker_input_not_found",
        message: "Implementation Blocker input file was not found.",
        details: { path: error.path },
        help: ["Create the file, then rerun the blocker command with `--file <path|->`."],
      });
    case "recording_text_file_unreadable":
    case "recording_text_stdin_unreadable":
      return usageError({
        code: "blocker_input_unreadable",
        message: "Implementation Blocker input is not readable.",
        details: "path" in error ? { path: error.path } : { path: "-" },
        help: ["Use a readable UTF-8 file or pipe UTF-8 text with `--file -`."],
      });
    case "recording_text_too_large":
      return usageError({
        code: "blocker_input_too_large",
        message: "Implementation Blocker input is larger than 256 KiB.",
        details: { path: error.path, maxBytes: error.maxBytes },
        help: ["Shorten the input to 256 KiB or less."],
      });
    case "recording_text_invalid_utf8":
      return usageError({
        code: "invalid_blocker_encoding",
        message: "Implementation Blocker input must be valid UTF-8.",
        details: { path: error.path },
        help: ["Rewrite the input as UTF-8 and rerun the command."],
      });
    case "recording_text_blank":
      return usageError({
        code: "empty_blocker",
        message: "Implementation Blocker input must not be blank.",
        details: { path: error.path },
        help: ["Provide non-blank text with `--file <path|->`."],
      });
    case "stdin_is_terminal":
      return usageError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with `--file -`."],
      });
  }
};
