type StderrStream = {
  readonly on: (event: "error", listener: (error: Error) => void) => unknown;
  readonly write: (message: string) => unknown;
};

export const bestEffortStderrWriter = (stream: StderrStream): ((message: string) => void) => {
  stream.on("error", () => undefined);
  return (message) => {
    try {
      stream.write(message);
    } catch {
      // Stderr diagnostics must not change command behavior or its structured result.
    }
  };
};
