import { Effect } from "effect";

export type HostInterruptionSignal = "SIGINT" | "SIGTERM";

export type HostInterruptionResult<A> =
  | { readonly ok: true; readonly value: A; readonly signal?: HostInterruptionSignal }
  | { readonly ok: false; readonly error: unknown; readonly signal?: HostInterruptionSignal };

type HostSignalSource = {
  readonly once: (signal: HostInterruptionSignal, listener: () => void) => unknown;
  readonly off: (signal: HostInterruptionSignal, listener: () => void) => unknown;
};

export const runWithHostInterruption = <A, E>(
  effect: Effect.Effect<A, E>,
  complete: (result: HostInterruptionResult<A>) => void,
  host: HostSignalSource,
): Promise<void> => {
  const interruption = new AbortController();
  let receivedSignal: HostInterruptionSignal | undefined;
  const interrupt = (signal: HostInterruptionSignal) => {
    receivedSignal = signal;
    interruption.abort();
  };
  const interruptWithSigint = () => interrupt("SIGINT");
  const interruptWithSigterm = () => interrupt("SIGTERM");
  host.once("SIGINT", interruptWithSigint);
  host.once("SIGTERM", interruptWithSigterm);

  return Effect.runPromise(effect, { signal: interruption.signal })
    .then(
      (value) =>
        complete({
          ok: true,
          value,
          ...(receivedSignal === undefined ? {} : { signal: receivedSignal }),
        }),
      (error: unknown) =>
        complete({
          ok: false,
          error,
          ...(receivedSignal === undefined ? {} : { signal: receivedSignal }),
        }),
    )
    .finally(() => {
      host.off("SIGINT", interruptWithSigint);
      host.off("SIGTERM", interruptWithSigterm);
    });
};

export const hostInterruptionExitCode = (
  signal: HostInterruptionSignal | undefined,
  fallback: number,
): number => (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : fallback);
