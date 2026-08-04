import type { AdvisorViewerState } from "./runtime.js";

type Component = {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  dispose?(): void;
};

type ViewerTheme = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

type ViewerOptions = {
  readonly getState: () => AdvisorViewerState;
  readonly subscribe: (listener: (state: AdvisorViewerState) => void) => () => void;
  readonly close: () => void;
  readonly requestRender: () => void;
  readonly theme: ViewerTheme;
  readonly getRows: () => number;
};

export class ImplementationAdvisorViewer implements Component {
  private state: AdvisorViewerState;
  private readonly unsubscribe: () => void;
  private readonly close: () => void;
  private readonly requestRender: () => void;
  private readonly theme: ViewerTheme;
  private readonly getRows: () => number;
  private scrollOffset = 0;
  private followTail = true;

  constructor(options: ViewerOptions) {
    this.state = options.getState();
    this.close = options.close;
    this.requestRender = options.requestRender;
    this.theme = options.theme;
    this.getRows = options.getRows;
    this.unsubscribe = options.subscribe((state) => {
      this.state = state;
      if (this.followTail) this.scrollOffset = Number.MAX_SAFE_INTEGER;
      this.invalidate();
      this.requestRender();
    });
  }

  handleInput(data: string): void {
    if (matchesViewerKey(data, "escape") || matchesViewerKey(data, "ctrl+c")) {
      this.close();
      return;
    }
    if (matchesViewerKey(data, "up") || matchesViewerKey(data, "pageUp")) {
      this.followTail = false;
      this.scrollOffset = Math.max(0, this.scrollOffset - (matchesViewerKey(data, "pageUp") ? 8 : 1));
      this.invalidate();
      this.requestRender();
      return;
    }
    if (matchesViewerKey(data, "down") || matchesViewerKey(data, "pageDown")) {
      this.scrollOffset += matchesViewerKey(data, "pageDown") ? 8 : 1;
      this.invalidate();
      this.requestRender();
      return;
    }
    if (matchesViewerKey(data, "home")) {
      this.followTail = false;
      this.scrollOffset = 0;
      this.invalidate();
      this.requestRender();
      return;
    }
    if (matchesViewerKey(data, "end")) {
      this.followTail = true;
      this.scrollOffset = Number.MAX_SAFE_INTEGER;
      this.invalidate();
      this.requestRender();
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(8, width - 2);
    const body = this.renderBody(innerWidth);
    const viewportHeight = Math.max(4, Math.min(40, this.getRows() - 4));
    const maxOffset = Math.max(0, body.length - viewportHeight);
    const offset = this.followTail ? maxOffset : Math.min(this.scrollOffset, maxOffset);
    const visible = body.slice(offset, offset + viewportHeight);
    const top = this.theme.fg(
      "borderAccent",
      `┌${"─".repeat(Math.max(0, width - 2))}┐`,
    );
    const bottom = this.theme.fg(
      "borderAccent",
      `└${"─".repeat(Math.max(0, width - 2))}┘`,
    );
    return [top, ...visible.map((line) => this.fit(line, innerWidth)), bottom];
  }

  invalidate(): void {}

  dispose(): void {
    this.unsubscribe();
  }

  private renderBody(width: number): string[] {
    const body: string[] = [];
    const title = this.state.sessionId === undefined
      ? "Implementation Advisor - no session"
      : `Implementation Advisor - session ${this.state.sessionId}`;
    body.push(this.theme.bold(this.theme.fg("accent", title)));
    body.push(this.theme.fg("muted", "Escape closes without changing the advisor or Implementer."));
    body.push("");

    if (this.state.transcript.length === 0) {
      body.push(this.theme.fg("muted", "No persisted advisor activity yet."));
    }
    for (const entry of this.state.transcript) {
      const label = entry.kind === "user"
        ? "user"
        : entry.kind === "assistant"
          ? "advisor"
          : entry.kind === "tool"
            ? "tool result"
            : entry.kind === "custom"
              ? "advisor note"
              : "session";
      const color = entry.kind === "assistant"
        ? "text"
        : entry.kind === "tool"
          ? "toolOutput"
          : entry.kind === "custom"
            ? "customMessageText"
            : "muted";
      body.push(this.theme.fg(color, `${label}:`));
      body.push(...wrapViewerText(entry.text, width - 2).map((line) => `  ${line}`));
    }

    if (this.state.activity.length > 0) {
      body.push("");
      body.push(this.theme.fg("accent", "Live activity"));
      for (const activity of this.state.activity) {
        const label = activity.kind === "assistant" ? "assistant" : "tool";
        const status = activity.status === "running" ? "running" : "complete";
        const color = activity.status === "running" ? "warning" : "muted";
        body.push(
          ...wrapViewerText(`${label} [${status}]: ${activity.text}`, width)
            .map((line) => this.theme.fg(color, line)),
        );
      }
    }

    if (this.state.latestRejectionReason !== undefined) {
      body.push("");
      body.push(this.theme.fg("error", "Latest host rejection"));
      body.push(...wrapViewerText(this.state.latestRejectionReason, width));
    }

    body.push("");
    body.push(this.theme.fg("muted", "↑/↓ scroll  PgUp/PgDn page  Home/End jump"));
    return body;
  }

  private fit(line: string, width: number): string {
    const value = ` ${line}`;
    const plain = stripAnsi(value);
    return plain.length <= width ? value : `${plain.slice(0, Math.max(0, width - 3))}...`;
  }
}

const matchesViewerKey = (data: string, key: string): boolean => {
  const aliases: Record<string, readonly string[]> = {
    escape: ["escape", "esc", "\\x1b", "\u001b"],
    "ctrl+c": ["ctrl+c", "\u0003"],
    up: ["up", "\u001b[A"],
    down: ["down", "\u001b[B"],
    pageUp: ["pageUp", "\u001b[5~"],
    pageDown: ["pageDown", "\u001b[6~"],
    home: ["home", "\u001b[H", "\u001b[1~"],
    end: ["end", "\u001b[F", "\u001b[4~"],
  };
  return (aliases[key] ?? [key]).includes(data);
};

const wrapViewerText = (text: string, width: number): string[] => {
  const lines: string[] = [];
  for (const source of text.split("\n")) {
    let remaining = source;
    while (remaining.length > width) {
      const split = remaining.lastIndexOf(" ", width);
      const cut = split > 0 ? split : width;
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
};

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "");
