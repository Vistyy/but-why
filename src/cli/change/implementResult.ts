import { runtimeError, success, type CliResult } from "../../cliResults.js";
import type { ChangeImplementResult } from "../../change/changeUseCases.js";
import type { HandoffFileReadError } from "../../change/handoffFile.js";
import { usageError } from "../../cliResults.js";

export const handoffFileError = (error: HandoffFileReadError): CliResult => {
  switch (error.code) {
    case "handoff_file_not_found":
      return usageError({
        code: error.code,
        message: "Change handoff file was not found.",
        details: { path: error.path },
        help: ["Create the handoff file, then rerun Change Implement."],
      });
    case "handoff_file_unreadable":
      return usageError({
        code: error.code,
        message: "Change handoff must be a readable regular file.",
        details: { path: error.path },
        help: ["Use a readable regular file for --handoff-file."],
      });
    case "handoff_file_too_large":
      return usageError({
        code: error.code,
        message: "Change handoff file is larger than 256 KiB.",
        details: { path: error.path, maxBytes: error.maxBytes },
        help: ["Shorten the handoff file to 256 KiB or less."],
      });
    case "invalid_handoff_encoding":
      return usageError({
        code: error.code,
        message: "Change handoff file must be valid UTF-8.",
        details: { path: error.path },
        help: ["Rewrite the handoff file as UTF-8, then retry Change Implement."],
      });
    case "empty_handoff_file":
      return usageError({
        code: error.code,
        message: "Change handoff file must not be empty.",
        details: { path: error.path },
        help: ["Write a non-empty handoff file, then retry Change Implement."],
      });
    case "stdin_is_terminal":
      return usageError({
        code: error.code,
        message: "Standard input is an interactive terminal.",
        help: ["Pipe UTF-8 text or use a shell heredoc with --handoff-file -."],
      });
  }
};

export const implementResult = (result: ChangeImplementResult): CliResult => {
  if (result.ok) {
    return success({
      changeId: result.change.id,
      worktreePath: result.change.worktreePath,
      host: result.host,
      status: result.status,
      ...(result.warning === undefined ? {} : { warning: result.warning }),
      ...(result.agentProfile === undefined
        ? {}
        : { agentProfile: result.agentProfile, profileScope: result.profileScope }),
    });
  }
  if (result.code === "change_not_found" || result.code === "change_not_open") {
    return runtimeError({
      code: result.code,
      message: result.code === "change_not_found" ? "Change was not found." : "Change is closed.",
      help: ["Use an open ready Change ID returned by `by change start --json`."],
    });
  }
  if (result.code === "change_not_ready") {
    return runtimeError({
      code: result.code,
      message: "Change is not ready for an Interactive Session.",
      details: { changeId: result.change.id, readiness: result.change.readiness },
      help: [`Run \`by change prepare ${result.change.id}\`, then retry Change Implement.`],
    });
  }
  if (result.code === "agent_environment_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      details: { changeId: result.change.id, worktreePath: result.change.worktreePath },
      help: ["Fix Repo Config in the Managed Worktree, then retry Change Implement."],
    });
  }
  if (result.code === "agent_profile_invalid") {
    return runtimeError({
      code: result.code,
      message: result.message,
      details: { changeId: result.change.id, worktreePath: result.change.worktreePath },
      help: ["Fix the selected Agent Profile, then retry Change Implement."],
    });
  }
  if ("message" in result) {
    return runtimeError({
      code: result.code,
      message: result.message,
      details: {
        changeId: result.change.id,
        worktreePath: result.change.worktreePath,
        host: "herdr",
        ...(result.code === "launch_failed" || result.code === "launch_indeterminate"
          ? result.evidence === undefined
            ? {}
            : { evidence: result.evidence }
          : {}),
      },
      help:
        result.code === "launch_indeterminate"
          ? ["Inspect the existing Herdr session, then retry only after launch state is resolved."]
          : ["Confirm Herdr is installed and running, then retry Change Implement."],
    });
  }
  throw new Error("Unhandled Change Implement result");
};
