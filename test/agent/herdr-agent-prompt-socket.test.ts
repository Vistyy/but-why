import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type HerdrAgentPromptTransportInput,
  herdr08MaxInitialRequestBytes,
  herdr08Protocol,
  sendHerdrAgentPrompt as sendPlatformHerdrAgentPrompt,
} from "../../src/change/interactiveSession/adapters/herdrAgentPromptSocket.js";

const roots: string[] = [];
const servers: Server[] = [];

const sendHerdrAgentPrompt = (input: Omit<HerdrAgentPromptTransportInput, "platform">) =>
  sendPlatformHerdrAgentPrompt({ ...input, platform: "linux" });

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("Herdr agent.prompt socket transport", () => {
  it.each([
    ["normal", "Implement this Change exactly."],
    ["over 128 KiB", `handoff:${"x".repeat(170_000)}`],
  ])("submits %s prompt text exactly after a compatible ping", async (_description, text) => {
    const requests: unknown[] = [];
    const socketPath = await listen((request, socket) => {
      requests.push(request);
      const envelope = request as { readonly id: string; readonly method: string };
      socket.end(
        `${JSON.stringify(
          envelope.method === "ping"
            ? {
                id: envelope.id,
                result: { type: "pong", version: "0.8.0", protocol: herdr08Protocol },
              }
            : {
                id: envelope.id,
                result: { type: "agent_prompted", agent: agentInfo() },
              },
        )}\n`,
      );
    });

    await expect(
      sendHerdrAgentPrompt({ socketPath, target: "by-c262", text, timeoutMs: 5_000 }),
    ).resolves.toEqual({ ok: true });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ method: "ping", params: {} });
    expect(requests[1]).toMatchObject({
      method: "agent.prompt",
      params: { target: "by-c262", text },
    });
  });

  it("rejects a prompt request larger than Herdr 0.8 accepts before connecting", async () => {
    const text = "x".repeat(herdr08MaxInitialRequestBytes);

    await expect(
      sendHerdrAgentPrompt({
        socketPath: join(tmpdir(), "must-not-connect.sock"),
        target: "by-c262",
        text,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      transmission: "none",
      message: expect.stringContaining("accepts at most 1048576 bytes"),
    });
  });

  it("rejects an incompatible protocol before transmitting agent.prompt", async () => {
    const methods: string[] = [];
    const socketPath = await listen((request, socket) => {
      const envelope = request as { readonly id: string; readonly method: string };
      methods.push(envelope.method);
      socket.end(
        `${JSON.stringify({
          id: envelope.id,
          result: { type: "pong", version: "0.9.0", protocol: herdr08Protocol + 1 },
        })}\n`,
      );
    });

    await expect(
      sendHerdrAgentPrompt({
        socketPath,
        target: "by-c262",
        text: "Do not transmit this prompt.",
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      transmission: "none",
      message: expect.stringContaining("incompatible"),
    });
    expect(methods).toEqual(["ping"]);
  });

  it("classifies a lost post-transmission response as unknown and does not retry", async () => {
    const methods: string[] = [];
    const socketPath = await listen((request, socket) => {
      const envelope = request as { readonly id: string; readonly method: string };
      methods.push(envelope.method);
      if (envelope.method === "ping") {
        socket.end(
          `${JSON.stringify({
            id: envelope.id,
            result: { type: "pong", version: "0.8.0", protocol: herdr08Protocol },
          })}\n`,
        );
        return;
      }
      socket.destroy();
    });

    await expect(
      sendHerdrAgentPrompt({
        socketPath,
        target: "by-c262",
        text: "Transmit once.",
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({ ok: false, transmission: "unknown" });
    expect(methods).toEqual(["ping", "agent.prompt"]);
  });

  it("classifies a post-transmission timeout as unknown", async () => {
    const methods: string[] = [];
    const socketPath = await listen((request, socket) => {
      const envelope = request as { readonly id: string; readonly method: string };
      methods.push(envelope.method);
      if (envelope.method === "ping") {
        socket.end(
          `${JSON.stringify({
            id: envelope.id,
            result: { type: "pong", version: "0.8.0", protocol: herdr08Protocol },
          })}\n`,
        );
      }
    });

    await expect(
      sendHerdrAgentPrompt({
        socketPath,
        target: "by-c262",
        text: "Wait for bounded confirmation.",
        timeoutMs: 20,
      }),
    ).resolves.toMatchObject({
      ok: false,
      transmission: "unknown",
      message: expect.stringContaining("timed out after 20 ms"),
    });
    expect(methods).toEqual(["ping", "agent.prompt"]);
  });

  it("treats a matching API error as a definite rejection", async () => {
    const methods: string[] = [];
    const socketPath = await listen((request, socket) => {
      const envelope = request as { readonly id: string; readonly method: string };
      methods.push(envelope.method);
      socket.end(
        `${JSON.stringify(
          envelope.method === "ping"
            ? {
                id: envelope.id,
                result: { type: "pong", version: "0.8.0", protocol: herdr08Protocol },
              }
            : {
                id: envelope.id,
                error: { code: "agent_not_ready", message: "agent is not ready" },
              },
        )}\n`,
      );
    });

    await expect(
      sendHerdrAgentPrompt({
        socketPath,
        target: "by-c262",
        text: "Rejected prompt.",
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({
      ok: false,
      transmission: "none",
      message: "agent_not_ready: agent is not ready",
    });
    expect(methods).toEqual(["ping", "agent.prompt"]);
  });
});

const listen = async (handle: (request: unknown, socket: Socket) => void): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), "but-why-herdr-socket-"));
  roots.push(root);
  const socketPath = join(root, "herdr.sock");
  const server = createServer((socket) => {
    let source = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      source += chunk;
      const newline = source.indexOf("\n");
      if (newline < 0) return;
      handle(JSON.parse(source.slice(0, newline)) as unknown, socket);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  return socketPath;
};

const agentInfo = () => ({
  terminal_id: "terminal-1",
  agent_status: "working",
  workspace_id: "workspace-1",
  tab_id: "tab-1",
  pane_id: "pane-1",
  focused: false,
  revision: 1,
});
