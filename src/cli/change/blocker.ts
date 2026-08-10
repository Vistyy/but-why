// fallow-ignore-file duplicate-export -- dynamically loaded command owner
// fallow-ignore-file unused-export -- dynamically imported by the CLI

import { Effect } from "effect";
import {
  loadImplementationBlockers,
  loadRaiseImplementationBlocker,
  loadResolveImplementationBlocker,
} from "../../change/loadChangeInspection.js";
import { type RecordingTextReadError, readRecordingText } from "../../cli/input/recordingText.js";
import type { CliResult } from "../../cliResults.js";
import { runtimeError, success } from "../../cliResults.js";
import * as support from "./changeSupport.js";
import type { ChangeCommandEnvironment } from "./changeTypes.js";

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
    const loaded = loadImplementationBlockers({ cwd: environment.cwd });
    if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
    return loaded.operation(changeId).pipe(
      Effect.map((history) =>
        history === undefined ? support.changeNotFound() : success({ changeId, ...history }),
      ),
      support.inspectionFailure,
    );
  }
  const content = readRecordingText(environment.cwd, command.file, environment.stdin);
  if (!content.ok) return Effect.succeed(blockerInputError(content.error));
  const loaded =
    action === "raise"
      ? loadRaiseImplementationBlocker({ cwd: environment.cwd })
      : loadResolveImplementationBlocker({ cwd: environment.cwd });
  if (!loaded.ok) return Effect.succeed(support.loadError(loaded.error));
  return loaded
    .operation({
      changeId,
      content: content.content,
      now: environment.now().toISOString(),
    })
    .pipe(
      Effect.map((result) =>
        result.ok
          ? success({ changeId, blocker: result.blocker, change: result.change })
          : runtimeError({
              code: result.code,
              message:
                result.code === "submission_in_progress"
                  ? "Change Submission is in progress."
                  : `Cannot ${action} an Implementation Blocker in this Change.`,
              details: { changeId },
              help:
                result.code === "submission_in_progress"
                  ? ["Wait for Change Submit to finish, then retry the blocker command."]
                  : ["Inspect the Change and use the applicable blocker lifecycle command."],
            }),
      ),
      support.inspectionFailure,
    );
};

const blockerInputError = (error: RecordingTextReadError): CliResult => {
  switch (error.code) {
    case "recording_text_file_not_found":
      return runtimeError({
        code: "decision_file_not_found",
        message: "Implementation Blocker content could not be read.",
        details: { path: error.path },
        help: ["Create the file, then rerun the blocker command with `--file <path|->`."],
      });
    case "recording_text_file_unreadable":
    case "recording_text_stdin_unreadable":
    case "recording_text_too_large":
    case "recording_text_invalid_utf8":
      return runtimeError({
        code:
          error.code === "recording_text_too_large"
            ? "decision_file_too_large"
            : error.code === "recording_text_invalid_utf8"
              ? "invalid_decision_encoding"
              : "decision_file_unreadable",
        message: "Implementation Blocker content could not be read.",
        details: "path" in error ? { path: error.path } : { path: "-" },
        help: ["Use a readable UTF-8 file or pipe UTF-8 text with `--file -`."],
      });
    case "recording_text_blank":
      return runtimeError({
        code: "empty_decision_file",
        message: "Implementation Blocker content could not be read.",
        details: { path: error.path },
        help: ["Provide non-blank UTF-8 text with `--file <path|->`."],
      });
    case "stdin_is_terminal":
      return runtimeError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with `--file -`."],
      });
  }
};
