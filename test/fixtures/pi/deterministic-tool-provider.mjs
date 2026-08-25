import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

let invocation = 0;

export default function registerDeterministicToolProvider(pi) {
  pi.registerProvider("but-why-test", {
    name: "But Why Test Provider",
    api: "but-why-test-api",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-key",
    models: [
      {
        id: "deterministic-tool",
        name: "Deterministic Tool",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 1024,
      },
    ],
    streamSimple(model) {
      invocation += 1;
      const path = process.env.PI_TEST_PROVIDER_CALLS;
      if (path !== undefined) appendFileSync(path, `${invocation}\n`);
      const stream = createAssistantMessageEventStream();
      const output = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "pending",
        timestamp: Date.now(),
      };
      if (invocation === 1) {
        const toolCall = {
          type: "toolCall",
          id: "real-pi-tool-call",
          name: "bash",
          arguments: { command: "printf normal-operation" },
        };
        output.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
        output.stopReason = "toolUse";
        stream.push({ type: "done", reason: "toolUse", message: output });
      } else {
        const text = "The tool completed.";
        output.content.push({ type: "text", text });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
        output.stopReason = "stop";
        stream.push({ type: "done", reason: "stop", message: output });
      }
      stream.end();
      return stream;
    },
  });
}
