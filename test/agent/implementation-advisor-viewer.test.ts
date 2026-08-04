import { describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createAdvisorViewerState } from "../../extensions/implementation-advisor/index.js";
import { ImplementationAdvisorViewer } from "../../extensions/implementation-advisor/viewer.js";

describe("Implementation Advisor viewer state", () => {
  it("binds transcript and live activity to one advisor session", () => {
    const session = SessionManager.inMemory("/worktree");
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Persisted advisor transcript" }],
      timestamp: Date.now(),
    } as never);

    const state = createAdvisorViewerState({
      sessionId: session.getSessionId(),
      entries: session.getBranch(),
      activity: [
        {
          id: "tool:read-1",
          kind: "tool",
          status: "running",
          text: "read src/example.ts",
        },
      ],
      latestRejectionReason:
        "Advisor result rejected: output cites evidence that the host did not capture.",
    });

    expect(state.sessionId).toBe(session.getSessionId());
    expect(state.transcript).toEqual([
      expect.objectContaining({
        kind: "assistant",
        text: "Persisted advisor transcript",
      }),
    ]);
    expect(state.activity).toEqual([
      expect.objectContaining({ id: "tool:read-1", status: "running" }),
    ]);
    expect(state.latestRejectionReason).toContain("host did not capture");
  });

  it("keeps host rejection text bounded", () => {
    const state = createAdvisorViewerState({
      sessionId: "current-advisor",
      entries: [],
      activity: [],
      latestRejectionReason: "x".repeat(800),
    });

    expect(state.latestRejectionReason).toHaveLength(500);
  });

  it("renders live updates, supports scrolling, and closes without a state mutation", () => {
    let state = createAdvisorViewerState({
      sessionId: "current-advisor",
      entries: [],
      activity: [{ id: "tool:read-1", kind: "tool", status: "running", text: "read current file" }],
      latestRejectionReason: "Advisor result rejected: host evidence was incomplete.",
    });
    let listener: ((next: typeof state) => void) | undefined;
    let requestRenderCount = 0;
    let closed = false;
    const viewer = new ImplementationAdvisorViewer({
      getState: () => state,
      subscribe: (next) => {
        listener = next;
        next(state);
        return () => {
          listener = undefined;
        };
      },
      close: () => {
        closed = true;
      },
      requestRender: () => {
        requestRenderCount += 1;
      },
      theme: {
        fg: (color, text) => `[${color}]${text}`,
        bold: (text) => `**${text}**`,
      },
      getRows: () => 24,
    });

    const initial = viewer.render(40).join("\n");
    expect(initial).toContain("Live activity");
    expect(initial).toContain("Latest host rejection");
    expect(initial).toContain("scroll");

    state = {
      ...state,
      activity: [
        { id: "assistant:1", kind: "assistant", status: "running", text: "new live response" },
      ],
    };
    listener?.(state);
    expect(requestRenderCount).toBeGreaterThan(1);
    expect(viewer.render(80).join("\n")).toContain("new live response");

    viewer.handleInput("home");
    viewer.handleInput("pageDown");
    viewer.handleInput("end");
    viewer.handleInput("escape");
    expect(closed).toBe(true);
    viewer.dispose();
  });
});
