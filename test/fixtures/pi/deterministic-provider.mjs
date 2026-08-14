import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const outputText = '<reviewer-output>{"findings":[]}</reviewer-output>';

export default function registerDeterministicProvider(pi) {
  pi.registerProvider("but-why-test", {
    name: "But Why Test Provider",
    api: "but-why-test-api",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-key",
    models: [
      {
        id: "deterministic-reviewer",
        name: "Deterministic Reviewer",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 1024,
      },
    ],
    streamSimple(model) {
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
      output.content.push({ type: "text", text: outputText });
      stream.push({ type: "start", partial: output });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_delta", contentIndex: 0, delta: outputText, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: outputText, partial: output });
      output.stopReason = "stop";
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
      return stream;
    },
  });
}
