export type ValidationCommandExecutor = (
  command: string,
  options?: { readonly cwd?: string },
) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;

export type ValidationCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

const timeoutExitCode = 124;

export const runValidationCommand = async (input: {
  readonly command: string;
  readonly timeoutSeconds: number;
  readonly completionMarker: string;
  readonly missingTimeoutMessage: string;
  readonly exec: ValidationCommandExecutor;
  readonly cwd?: string;
}): Promise<ValidationCommandResult> => {
  const available = await input.exec("command -v timeout >/dev/null 2>&1");
  if (available.exitCode !== 0) throw new Error(input.missingTimeoutMessage);

  const result = await input.exec(
    timeoutWrappedCommand(input.command, input.timeoutSeconds, input.completionMarker),
    input.cwd === undefined ? undefined : { cwd: input.cwd },
  );
  const parsed = parseCompletionMarker(result.stderr, input.completionMarker);
  return {
    exitCode: parsed.completed ? parsed.exitCode : timeoutExitCode,
    stdout: result.stdout,
    stderr: parsed.stderr,
    timedOut: !parsed.completed,
  };
};

const timeoutWrappedCommand = (command: string, timeoutSeconds: number, marker: string): string =>
  [
    `timeout ${timeoutSeconds}s sh -c`,
    shellQuote(`sh -c "$1"
command_exit_code=$?
printf '\n%s:%s\n' "$2" "$command_exit_code" >&2
exit "$command_exit_code"`),
    "_",
    shellQuote(command),
    shellQuote(marker),
  ].join(" ");

const parseCompletionMarker = (
  stderr: string,
  marker: string,
):
  | { readonly completed: true; readonly exitCode: number; readonly stderr: string }
  | { readonly completed: false; readonly stderr: string } => {
  const markerMatch = stderr.match(new RegExp(`\\n${marker}:(\\d+)\\n?$`));
  if (markerMatch === null) return { completed: false, stderr };
  return {
    completed: true,
    exitCode: Number(markerMatch[1]),
    stderr: stderr.slice(0, markerMatch.index),
  };
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
