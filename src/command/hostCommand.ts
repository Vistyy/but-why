import * as Command from "@effect/platform/Command";
import type * as CommandExecutor from "@effect/platform/CommandExecutor";
import type { PlatformError } from "@effect/platform/Error";
import { NodeCommandExecutor, NodeFileSystem } from "@effect/platform-node";
import { Cause, Chunk, Data, Effect, Exit, Layer, Stream } from "effect";

export type HostCommandInput = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly stdin?: string;
  readonly signal?: AbortSignal;
};

export type HostCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class HostCommandError extends Data.TaggedError("HostCommandError")<{
  readonly message: string;
  readonly cause: PlatformError;
}> {}

const commandLayer = NodeCommandExecutor.layer.pipe(Layer.provide(NodeFileSystem.layer));

const collectText = (stream: Stream.Stream<Uint8Array, PlatformError>) =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) => Buffer.concat(Chunk.toReadonlyArray(chunks)).toString("utf8")),
  );

const runCommand = (
  input: HostCommandInput,
  executorLayer: Layer.Layer<CommandExecutor.CommandExecutor>,
): Effect.Effect<HostCommandResult, PlatformError, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const baseCommand = Command.make(input.command, ...(input.args ?? [])).pipe(
        input.stdin === undefined ? Command.stdin(Stream.empty) : Command.feed(input.stdin),
      );
      const command =
        input.cwd === undefined ? baseCommand : Command.workingDirectory(baseCommand, input.cwd);
      const runningCommand = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const process = yield* Command.start(command);
          yield* Effect.addFinalizer(() => terminateProcessTree(process));
          return process;
        }),
      );
      const [exitCode, stdout, stderr] = yield* Effect.all(
        [
          runningCommand.exitCode,
          collectText(runningCommand.stdout),
          collectText(runningCommand.stderr),
        ] as const,
        { concurrency: "unbounded" },
      );
      return { exitCode: Number(exitCode), stdout, stderr };
    }),
  ).pipe(Effect.provide(executorLayer));

export const executeHostCommandEffect = (
  input: HostCommandInput,
  executorLayer: Layer.Layer<CommandExecutor.CommandExecutor> = commandLayer,
) =>
  runCommand(input, executorLayer).pipe(
    Effect.mapError(
      (error) => new HostCommandError({ message: commandErrorMessage(input, error), cause: error }),
    ),
  );

const terminateProcessTree = (
  runningCommand: CommandExecutor.Process,
): Effect.Effect<void, never> => runningCommand.kill("SIGKILL").pipe(Effect.ignore);

export const executeHostCommand = async (input: HostCommandInput): Promise<HostCommandResult> => {
  const exit = await Effect.runPromiseExit(executeHostCommandEffect(input), {
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.isFailType(exit.cause)) throw exit.cause.error;
  throw Cause.squash(exit.cause);
};

const commandErrorMessage = (input: HostCommandInput, error: PlatformError): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not execute ${input.command}: ${message}`;
};
