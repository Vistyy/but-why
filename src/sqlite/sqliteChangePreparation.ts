import type { ChangePrepareFailure } from "../change/change.js";

export const encodeSqliteChangePrepareFailure = (failure: ChangePrepareFailure): string =>
  JSON.stringify(failure);

export const decodeSqliteChangePrepareFailure = (encoded: string): ChangePrepareFailure => {
  const value: unknown = JSON.parse(encoded);

  if (
    typeof value !== "object" ||
    value === null ||
    !("command" in value) ||
    typeof value.command !== "string" ||
    !("exitCode" in value) ||
    typeof value.exitCode !== "number" ||
    !("timedOut" in value) ||
    typeof value.timedOut !== "boolean" ||
    !("stdout" in value) ||
    typeof value.stdout !== "string" ||
    !("stderr" in value) ||
    typeof value.stderr !== "string"
  ) {
    throw new Error("Stored Change preparation failure is invalid");
  }

  return {
    command: value.command,
    exitCode: value.exitCode,
    timedOut: value.timedOut,
    stdout: value.stdout,
    stderr: value.stderr,
  };
};
