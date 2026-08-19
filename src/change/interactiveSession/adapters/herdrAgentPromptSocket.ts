import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import { Either, Schema } from "effect";

export const herdr08Protocol = 19;
export const herdr08MaxInitialRequestBytes = 1024 * 1024;
export const herdr08InitialRequestTimeoutMs = 5_000;

export type HerdrAgentPromptTransportInput = {
  readonly socketPath: string;
  readonly platform: NodeJS.Platform;
  readonly target: string;
  readonly text: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
};

export type HerdrAgentPromptTransportResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly transmission: "none" | "unknown";
      readonly message: string;
    };

export type HerdrAgentPromptTransport = (
  input: HerdrAgentPromptTransportInput,
) => Promise<HerdrAgentPromptTransportResult>;

type HerdrSocketExchangeResult =
  | { readonly ok: true; readonly response: unknown }
  | {
      readonly ok: false;
      readonly transmission: "none" | "unknown";
      readonly message: string;
    };

const nonBlankStringSchema = Schema.String.pipe(Schema.filter((value) => value.length > 0));
const herdrPingResponseSchema = Schema.Struct({
  id: Schema.String,
  result: Schema.Struct({
    type: Schema.Literal("pong"),
    version: Schema.String,
    protocol: Schema.Number,
  }),
});
const herdrPromptedResponseSchema = Schema.Struct({
  id: Schema.String,
  result: Schema.Struct({
    type: Schema.Literal("agent_prompted"),
    agent: Schema.Struct({
      terminal_id: nonBlankStringSchema,
      agent_status: Schema.Literal("idle", "working", "blocked", "unknown", "done"),
      workspace_id: nonBlankStringSchema,
      tab_id: nonBlankStringSchema,
      pane_id: nonBlankStringSchema,
      focused: Schema.Boolean,
      revision: Schema.Number,
    }),
  }),
});
const herdrErrorResponseSchema = Schema.Struct({
  id: Schema.String,
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});

export const sendHerdrAgentPrompt: HerdrAgentPromptTransport = async (input) => {
  const promptId = `but-why-agent-prompt-${randomUUID()}`;
  const promptRequest = {
    id: promptId,
    method: "agent.prompt",
    params: { target: input.target, text: input.text },
  } as const;
  const promptLine = encodeRequest(promptRequest);
  if (!promptLine.ok) return promptLine;

  const pingId = `but-why-ping-${randomUUID()}`;
  const pingLine = encodeRequest({ id: pingId, method: "ping", params: {} });
  if (!pingLine.ok) return pingLine;
  const ping = await exchangeHerdrRequest({
    socketPath: input.socketPath,
    platform: input.platform,
    line: pingLine.line,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    mutation: false,
  });
  if (!ping.ok) return { ...ping, transmission: "none" };
  const pingResponse = decodeUnknown(ping.response, herdrPingResponseSchema);
  if (pingResponse === undefined || pingResponse.id !== pingId) {
    return {
      ok: false,
      transmission: "none",
      message: "Herdr returned a malformed or mismatched ping response.",
    };
  }
  if (pingResponse.result.protocol !== herdr08Protocol) {
    return {
      ok: false,
      transmission: "none",
      message: `Herdr protocol ${pingResponse.result.protocol} is incompatible with required protocol ${herdr08Protocol}.`,
    };
  }

  const prompted = await exchangeHerdrRequest({
    socketPath: input.socketPath,
    platform: input.platform,
    line: promptLine.line,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    mutation: true,
  });
  if (!prompted.ok) return prompted;

  const errorResponse = decodeUnknown(prompted.response, herdrErrorResponseSchema);
  if (errorResponse !== undefined && errorResponse.id === promptId) {
    return {
      ok: false,
      transmission: "none",
      message: `${errorResponse.error.code}: ${errorResponse.error.message}`,
    };
  }
  const response = decodeUnknown(prompted.response, herdrPromptedResponseSchema);
  if (response === undefined || response.id !== promptId) {
    return {
      ok: false,
      transmission: "unknown",
      message: "Herdr returned a malformed or mismatched agent_prompted response.",
    };
  }
  return { ok: true };
};

const encodeRequest = (
  request: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly transmission: "none"; readonly message: string } => {
  const line = JSON.stringify(request);
  const bytes = Buffer.byteLength(line, "utf8");
  return bytes <= herdr08MaxInitialRequestBytes
    ? { ok: true, line }
    : {
        ok: false,
        transmission: "none",
        message: `Herdr socket request is ${bytes} bytes; Herdr 0.8 accepts at most ${herdr08MaxInitialRequestBytes} bytes.`,
      };
};

const exchangeHerdrRequest = (input: {
  readonly socketPath: string;
  readonly platform: NodeJS.Platform;
  readonly line: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly mutation: boolean;
}): Promise<HerdrSocketExchangeResult> =>
  new Promise((resolve) => {
    let settled = false;
    let writeStarted = false;
    let response = Buffer.alloc(0);
    const socketPath =
      input.platform === "win32" ? `\\\\.\\pipe\\${input.socketPath}` : input.socketPath;
    const socket = createConnection(socketPath);
    const timeoutMs = Math.min(input.timeoutMs, herdr08InitialRequestTimeoutMs);

    const finish = (result: HerdrSocketExchangeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(result);
    };
    const failure = (message: string): HerdrSocketExchangeResult => ({
      ok: false,
      transmission: input.mutation && writeStarted ? "unknown" : "none",
      message,
    });
    const onAbort = (): void => finish(failure("Herdr socket request was interrupted."));
    const timer = setTimeout(
      () => finish(failure(`Herdr socket request timed out after ${timeoutMs} ms.`)),
      timeoutMs,
    );

    if (input.signal?.aborted === true) {
      finish(failure("Herdr socket request was interrupted."));
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      if (input.mutation) writeStarted = true;
      socket.write(`${input.line}\n`, "utf8", (error) => {
        if (error !== undefined && error !== null) {
          finish(failure(`Herdr socket write failed: ${error.message}`));
        }
      });
    });
    socket.on("data", (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > herdr08MaxInitialRequestBytes) {
        finish(failure("Herdr socket response exceeded 1048576 bytes."));
        return;
      }
      const newline = response.indexOf(0x0a);
      if (newline < 0) return;
      const source = response.subarray(0, newline).toString("utf8");
      try {
        finish({ ok: true, response: JSON.parse(source) as unknown });
      } catch {
        finish(failure("Herdr socket returned malformed JSON."));
      }
    });
    socket.once("error", (error) => finish(failure(`Herdr socket failed: ${error.message}`)));
    socket.once("end", () => finish(failure("Herdr socket closed before returning a response.")));
  });

const decodeUnknown = <A, I>(value: unknown, schema: Schema.Schema<A, I>): A | undefined => {
  const decoded = Schema.decodeUnknownEither(schema, { onExcessProperty: "ignore" })(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
};
