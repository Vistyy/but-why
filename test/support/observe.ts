export type ObserveUntilOptions<T> = {
  readonly description: string;
  readonly observe: () => T | Promise<T>;
  readonly isReady?: (value: T) => boolean;
  readonly timeoutMs: number;
  readonly pollIntervalMs?: number;
};

export class ObservationDeadlineExceeded extends Error {
  readonly elapsedMs: number;
  readonly timeoutMs: number;
  readonly description: string;

  constructor(description: string, elapsedMs: number, timeoutMs: number) {
    super(
      `Timed out after ${elapsedMs} ms waiting for ${description}; deadline was ${timeoutMs} ms.`,
    );
    this.name = "ObservationDeadlineExceeded";
    this.description = description;
    this.elapsedMs = elapsedMs;
    this.timeoutMs = timeoutMs;
  }
}

const readyByDefault = <T>(value: T): boolean => Boolean(value);

const deadlineError = (description: string, startedAt: number, timeoutMs: number) =>
  new ObservationDeadlineExceeded(
    description,
    Math.round(performance.now() - startedAt),
    timeoutMs,
  );

const observeWithDeadline = async <T>(
  observe: () => T | Promise<T>,
  description: string,
  startedAt: number,
  remainingMs: number,
  timeoutMs: number,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(observe),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(deadlineError(description, startedAt, timeoutMs)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const observeUntil = async <T>({
  description,
  observe,
  isReady = readyByDefault,
  timeoutMs,
  pollIntervalMs = 10,
}: ObserveUntilOptions<T>): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Observation deadline must be finite and positive for ${description}.`);
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error(
      `Observation poll interval must be finite and non-negative for ${description}.`,
    );
  }

  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  while (true) {
    const remainingBeforeObservationMs = deadline - performance.now();
    if (remainingBeforeObservationMs <= 0) {
      throw deadlineError(description, startedAt, timeoutMs);
    }
    const value = await observeWithDeadline(
      observe,
      description,
      startedAt,
      remainingBeforeObservationMs,
      timeoutMs,
    );
    if (isReady(value)) return value;

    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) {
      throw deadlineError(description, startedAt, timeoutMs);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(pollIntervalMs, remainingMs));
    });
  }
};
