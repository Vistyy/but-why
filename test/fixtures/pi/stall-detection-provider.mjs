import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const outputText = '<reviewer-output>{"decision":"continue","reason":"The trajectory is ambiguous."}</reviewer-output>';

export default function registerStallDetectionProvider(pi) {
  pi.registerProvider("by-why-test", {
    name: "But Why Stall Detection Test Provider",
    api: "but-why-test-api",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-key",
    models: [{
      id: "deterministic-stall-detector",
      name: "Deterministic Stall Detector",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
      maxTokens: 1024,
    }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const message = {
        role: "assistant",
        content: [{ type: "text", text: outputText }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: message });
      stream.push({ type: "text_start", contentIndex: 0, partial: message });
      stream.push({ type: "text_delta", contentIndex: 0, delta: outputText, partial: message });
      stream.push({ type: "text_end", contentIndex: 0, content: outputText, partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end();
      return stream;
    },
  });
}
