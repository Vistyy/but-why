export type RepositoryPreparationExecutor = (
  command: string,
  options?: { readonly cwd?: string },
) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;

export type RepositoryPreparationResult = {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

const timeoutExitCode = 124;

export const runRepositoryPreparation = async (input: {
  readonly prepare: { readonly command: string; readonly timeoutSeconds: number };
  readonly exec: RepositoryPreparationExecutor;
  readonly cwd?: string;
}): Promise<RepositoryPreparationResult> => {
  const available = await input.exec("command -v timeout >/dev/null 2>&1");
  if (available.exitCode !== 0) {
    throw new Error("Could not find timeout command for prepare.");
  }

  const marker = "__BUTWHY_PREPARE_COMPLETED_prepare__";
  const result = await input.exec(timeoutWrappedCommand(input.prepare, marker), {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  });
  const parsed = parseCompletionMarker(result.stderr, marker);

  return {
    command: input.prepare.command,
    exitCode: parsed.completed ? parsed.exitCode : timeoutExitCode,
    stdout: result.stdout,
    stderr: parsed.stderr,
    timedOut: !parsed.completed,
  };
};

const timeoutWrappedCommand = (
  prepare: { readonly command: string; readonly timeoutSeconds: number },
  marker: string,
): string =>
  [
    `timeout ${prepare.timeoutSeconds}s sh -c`,
    shellQuote(`sh -c "$1"
prepare_exit_code=$?
printf '\n%s:%s\n' "$2" "$prepare_exit_code" >&2
exit "$prepare_exit_code"`),
    "_",
    shellQuote(prepare.command),
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
