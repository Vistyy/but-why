import * as Command from "@effect/platform/Command";
import type * as CommandExecutor from "@effect/platform/CommandExecutor";
import { NodeCommandExecutor, NodeFileSystem } from "@effect/platform-node";
import { Chunk, Effect, Layer, Stream } from "effect";

export type HostCommandInput = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly signal?: AbortSignal;
};

export type HostCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class HostCommandError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

const commandLayer = NodeCommandExecutor.layer.pipe(Layer.provide(NodeFileSystem.layer));

const collectText = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) => Buffer.concat(Chunk.toReadonlyArray(chunks)).toString("utf8")),
  );

const runCommand = (
  input: HostCommandInput,
  executorLayer: Layer.Layer<CommandExecutor.CommandExecutor>,
): Effect.Effect<HostCommandResult, unknown, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const baseCommand = Command.make(input.command, ...(input.args ?? []));
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
    Effect.mapError((error) => new HostCommandError(commandErrorMessage(input, error), error)),
  );

const terminateProcessTree = (
  runningCommand: CommandExecutor.Process,
): Effect.Effect<void, never> =>
  runningCommand.isRunning.pipe(
    Effect.flatMap((isRunning) =>
      isRunning ? runningCommand.kill("SIGKILL").pipe(Effect.ignore) : Effect.void,
    ),
    Effect.catchAll(() => Effect.void),
  );

export const executeHostCommand = async (input: HostCommandInput): Promise<HostCommandResult> => {
  try {
    return await Effect.runPromise(executeHostCommandEffect(input), {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch (error) {
    throw new HostCommandError(commandErrorMessage(input, error), error);
  }
};

const commandErrorMessage = (input: HostCommandInput, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not execute ${input.command}: ${message}`;
};
