import { createHash } from "node:crypto";
import {
  type ExecResult,
  type ExtensionAPI,
  type ExtensionContext,
  isToolCallEventType,
  type SessionEntry,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";

type ChangeState = "open" | "closed";
type ChangeCloseReason = "completed" | "cancelled";

type JsonObject = Readonly<Record<string, unknown>>;

type ChangeCleanup = JsonObject & {
  readonly state: "complete" | "pending";
};

type CurrentCandidate = JsonObject & {
  readonly id: number;
  readonly headSha: string;
};

type CurrentValidationRun = JsonObject & {
  readonly id: number;
  readonly state: "running" | "complete";
};

type BlockerResolution = JsonObject & {
  readonly blockerId: number;
  readonly content: string;
};

type ImplementationBlocker = JsonObject & {
  readonly id: number;
  readonly changeId: string;
  readonly content: string;
  readonly resolution: BlockerResolution | null;
};

export type ChangeInspectionSnapshot = {
  readonly change: {
    readonly state: ChangeState;
    readonly closeReason: ChangeCloseReason | null;
    readonly acceptanceContext: JsonObject | null;
    readonly baseRef?: string | null;
  };
  readonly currentCandidate: CurrentCandidate | null;
  readonly currentValidationRun: CurrentValidationRun | null;
  readonly findingCount: number;
  readonly toolingFailureCount: number;
  readonly pullRequest: Readonly<Record<string, unknown>> | null;
  readonly cleanup?: ChangeCleanup;
  readonly publication?: {
    readonly candidateId: number;
    readonly expectedHeadSha: string;
    readonly pullRequest: Readonly<Record<string, unknown>> | null;
  } | null;
};

type BlockerHistory = {
  readonly blockers: readonly ImplementationBlocker[];
  readonly resolutions: readonly BlockerResolution[];
  readonly active: ImplementationBlocker | null;
};

export type ContinuationDecision =
  | { readonly kind: "findings" }
  | { readonly kind: "general" }
  | { readonly kind: "idle" };

export type RetryState = {
  readonly fingerprint: string;
  readonly unchangedRestarts: number;
};

type PersistedContinuationState = RetryState & {
  readonly changeId: string;
  readonly paused: boolean;
  readonly resolutionBlockerId?: number | null;
  readonly pendingResolutionBlockerId?: number | null;
  readonly initialSubmissionHandled?: boolean;
};

type WatcherDisplay =
  | { readonly kind: "implementing"; readonly pullRequestUrl: string | null }
  | { readonly kind: "validating"; readonly pullRequestUrl: string | null }
  | { readonly kind: "checking" }
  | { readonly kind: "paused" }
  | { readonly kind: "complete" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "cleanup-needed" }
  | { readonly kind: "idle" }
  | { readonly kind: "blocked" }
  | { readonly kind: "inspection-failed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "waiting-for-human-review"; readonly pullRequestUrl: string };

type RunResult =
  | { readonly ok: true; readonly stdout: string }
  | {
      readonly ok: false;
      readonly transient: boolean;
      readonly message: string;
      readonly stdout: string;
    };

type GitInspection = {
  readonly head: string;
  readonly status: string;
  readonly unstagedDiff: string;
  readonly stagedDiff: string;
  readonly untrackedFiles: readonly { readonly path: string; readonly hash: string }[];
};

type InspectionResult =
  | {
      readonly ok: true;
      readonly snapshot: ChangeInspectionSnapshot;
      readonly blockerHistory: BlockerHistory;
      readonly fingerprint: string;
      readonly git: GitInspection;
    }
  | { readonly ok: false; readonly transient: boolean; readonly message: string };

type BlockerInspectionResult =
  | { readonly ok: true; readonly blockerHistory: BlockerHistory }
  | { readonly ok: false; readonly message: string };

const stateEntry = "but-why-change-continuation";
const watcherWidget = "but-why-change-watcher";
const maxUnchangedRestarts = 3;
const blockerPollingIntervalMs = 30_000;
const changeIdPattern = /^\s*Change identity:\s*([A-Z][A-Z0-9]{1,9}-C[1-9][0-9]*)\.?\s*$/mu;
const butWhyCommand = (...args: readonly string[]): string => ["by", ...args].join(" ");

type ContinueChangeWidget = {
  readonly render: (width: number) => string[];
  readonly invalidate: () => void;
};

type ContinueChangeWidgetFactory = (
  tui: unknown,
  theme: { readonly fg: (color: ThemeColor, text: string) => string },
) => ContinueChangeWidget;

type ContinueChangeToolCallEvent = {
  readonly input: { readonly command: string };
  readonly [key: string]: unknown;
};

type ContinueChangeAgentEndEvent = {
  readonly messages: readonly {
    readonly role: string;
    readonly stopReason: string | undefined;
    readonly [key: string]: unknown;
  }[];
};

type ContinueChangeInputEvent = {
  readonly text: string;
  readonly source: "interactive" | "rpc" | "extension";
};

type ContinueChangeTurnEndEvent = {
  readonly hasToolResults: boolean;
};

type ContinueChangeToolCallResult = { readonly block: true; readonly reason: string };

export type ContinueChangeContext = {
  readonly cwd: string;
  readonly sessionManager: {
    readonly getBranch: () => readonly SessionEntry[];
  };
  readonly isIdle: () => boolean;
  readonly ui: {
    readonly notify: (message: string, type?: "info" | "warning" | "error") => void;
    readonly setWidget: (content: ContinueChangeWidgetFactory | undefined) => void;
  };
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
};

type ContinueChangeExecOptions = {
  readonly cwd?: string;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
};

export type ContinueChangeCapabilities = {
  readonly onToolCall: (
    handler: (
      event: ContinueChangeToolCallEvent,
      context: ContinueChangeContext,
    ) =>
      | ContinueChangeToolCallResult
      | undefined
      | Promise<ContinueChangeToolCallResult | undefined>,
  ) => void;
  readonly onSessionStart: (
    handler: (context: ContinueChangeContext) => void | Promise<void>,
  ) => void;
  readonly onSessionShutdown: (
    handler: (context: ContinueChangeContext) => void | Promise<void>,
  ) => void;
  readonly onAgentEnd: (
    handler: (
      event: ContinueChangeAgentEndEvent,
      context: ContinueChangeContext,
    ) => void | Promise<void>,
  ) => void;
  readonly onAgentSettled: (
    handler: (context: ContinueChangeContext) => void | Promise<void>,
  ) => void;
  readonly onInput: (
    handler: (
      event: ContinueChangeInputEvent,
      context: ContinueChangeContext,
    ) => void | Promise<void>,
  ) => void;
  readonly onTurnEnd: (
    handler: (
      event: ContinueChangeTurnEndEvent,
      context: ContinueChangeContext,
    ) => void | Promise<void>,
  ) => void;
  readonly registerCommand: (
    name: string,
    options: {
      readonly description: string;
      readonly handler: (args: string, context: ContinueChangeContext) => void | Promise<void>;
    },
  ) => void;
  readonly appendContinuationState: (state: PersistedContinuationState) => void;
  readonly sendUserMessage: (
    content: string,
    options?: { readonly deliverAs?: "steer" | "followUp" },
  ) => void;
  readonly exec: (
    command: string,
    args: string[],
    options?: ContinueChangeExecOptions,
  ) => Promise<ExecResult>;
};

const adaptExtensionContext = (context: ExtensionContext): ContinueChangeContext => ({
  cwd: context.cwd,
  sessionManager: { getBranch: () => context.sessionManager.getBranch() },
  isIdle: () => context.isIdle(),
  signal: context.signal,
  abort: () => context.abort(),
  ui: {
    notify: (message, type) => context.ui.notify(message, type),
    setWidget: (content) =>
      context.ui.setWidget(
        watcherWidget,
        content === undefined
          ? undefined
          : (tui, theme) => content(tui, { fg: (color, text) => theme.fg(color, text) }),
      ),
  },
});

const adaptExtensionApi = (api: ExtensionAPI): ContinueChangeCapabilities => ({
  onToolCall: (handler) =>
    api.on("tool_call", (event, context) => {
      if (!isToolCallEventType("bash", event)) return;
      return handler({ input: { command: event.input.command } }, adaptExtensionContext(context));
    }),
  onSessionStart: (handler) =>
    api.on("session_start", (_event, context) => handler(adaptExtensionContext(context))),
  onSessionShutdown: (handler) =>
    api.on("session_shutdown", (_event, context) => handler(adaptExtensionContext(context))),
  onAgentEnd: (handler) =>
    api.on("agent_end", (event, context) =>
      handler(
        {
          messages: event.messages.map((message) => ({
            role: message.role,
            stopReason: "stopReason" in message ? message.stopReason : undefined,
          })),
        },
        adaptExtensionContext(context),
      ),
    ),
  onAgentSettled: (handler) =>
    api.on("agent_settled", (_event, context) => handler(adaptExtensionContext(context))),
  onInput: (handler) =>
    api.on("input", (event, context) =>
      handler({ text: event.text, source: event.source }, adaptExtensionContext(context)),
    ),
  onTurnEnd: (handler) =>
    api.on("turn_end", (event, context) =>
      handler({ hasToolResults: event.toolResults.length > 0 }, adaptExtensionContext(context)),
    ),
  registerCommand: (name, options) =>
    api.registerCommand(name, {
      description: options.description,
      handler: async (args, context) => options.handler(args, adaptExtensionContext(context)),
    }),
  appendContinuationState: (state) => api.appendEntry(stateEntry, state),
  sendUserMessage: (content, options) => api.sendUserMessage(content, options),
  exec: (command, args, options) => api.exec(command, args, options),
});

export const extractChangeId = (text: string): string | undefined =>
  text.match(changeIdPattern)?.[1];

const submitCommandPattern =
  /(?:^|[\n;|&){}]|(?<!=)\()\s*(?:(?:if|then|elif|else|while|until|do|!)\s+)*by\s+change\s+submit(?:\s|$)/gu;

type ShellLineState = {
  readonly quote: "'" | '"' | undefined;
  readonly arithmeticDepth: number;
};

const hereDocumentDeclarations = (
  line: string,
  state: ShellLineState,
): {
  readonly declarations: Array<{ readonly delimiter: string; readonly stripTabs: boolean }>;
  readonly state: ShellLineState;
} => {
  const declarations: Array<{ readonly delimiter: string; readonly stripTabs: boolean }> = [];
  let { quote, arithmeticDepth } = state;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(" && line[index + 1] === "(") {
      arithmeticDepth += 1;
      index += 1;
      continue;
    }
    if (arithmeticDepth > 0 && character === ")" && line[index + 1] === ")") {
      arithmeticDepth -= 1;
      index += 1;
      continue;
    }
    if (arithmeticDepth > 0) continue;
    if (character === "#" && (index === 0 || /[\s;|&(){}]/u.test(line[index - 1] ?? ""))) break;
    if (character !== "<" || line[index + 1] !== "<") continue;
    let cursor = index + 2;
    const stripTabs = line[cursor] === "-";
    if (stripTabs) cursor += 1;
    while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
    let delimiter = "";
    let delimiterQuote: "'" | '"' | undefined;
    for (; cursor < line.length; cursor += 1) {
      const delimiterCharacter = line[cursor] ?? "";
      if (delimiterQuote !== undefined) {
        if (delimiterCharacter === delimiterQuote) delimiterQuote = undefined;
        else if (delimiterCharacter === "\\" && delimiterQuote === '"') {
          cursor += 1;
          delimiter += line[cursor] ?? "";
        } else delimiter += delimiterCharacter;
      } else if (delimiterCharacter === "'" || delimiterCharacter === '"') {
        delimiterQuote = delimiterCharacter;
      } else if (delimiterCharacter === "\\") {
        cursor += 1;
        delimiter += line[cursor] ?? "";
      } else if (/[\s;|&()<>]/u.test(delimiterCharacter)) {
        break;
      } else {
        delimiter += delimiterCharacter;
      }
    }
    if (delimiter !== "") {
      declarations.push({ delimiter, stripTabs });
      index = cursor - 1;
    }
  }
  return { declarations, state: { quote, arithmeticDepth } };
};

const withoutHereDocumentBodies = (command: string): string => {
  const lines = command.split(/(?<=\n)/u);
  const pending: Array<{ readonly delimiter: string; readonly stripTabs: boolean }> = [];
  let scanState: ShellLineState = { quote: undefined, arithmeticDepth: 0 };
  return lines
    .map((line) => {
      const body = pending[0];
      if (body !== undefined) {
        const value = line.replace(/\n$/u, "");
        if ((body.stripTabs ? value.replace(/^\t+/u, "") : value) === body.delimiter) {
          pending.shift();
        }
        return line.endsWith("\n") ? `${" ".repeat(line.length - 1)}\n` : " ".repeat(line.length);
      }
      const scanned = hereDocumentDeclarations(line, scanState);
      pending.push(...scanned.declarations);
      scanState = scanned.state;
      return line;
    })
    .join("");
};

const visibleShellText = (rawCommand: string): string => {
  const command = withoutHereDocumentBodies(rawCommand);
  let result = "";
  let quote: "'" | '"' | undefined;
  let comment = false;
  let arrayDepth = 0;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (comment) {
      if (character === "\n") {
        comment = false;
        result += character;
      } else {
        result += " ";
      }
      continue;
    }
    if (arrayDepth > 0 && quote === undefined) {
      if (
        (character === "$" || character === "<" || character === ">") &&
        command[index + 1] === "("
      ) {
        const closing = findCommandSubstitutionEnd(command, index + 2);
        if (closing !== undefined) {
          result += `( ${visibleShellText(command.slice(index + 2, closing))} )`;
          index = closing;
          continue;
        }
      }
      if (character === "`") {
        const closing = command.indexOf("`", index + 1);
        if (closing !== -1) {
          result += `( ${visibleShellText(command.slice(index + 1, closing))} )`;
          index = closing;
          continue;
        }
      }
      if (character === "\\") {
        result += " ".repeat(Math.min(2, command.length - index));
        index += 1;
        continue;
      }
      if (character === "#" && (index === 0 || /[\s;|&(){}]/u.test(command[index - 1] ?? ""))) {
        comment = true;
      } else if (character === "'" || character === '"') quote = character;
      else if (character === "(") arrayDepth += 1;
      else if (character === ")") arrayDepth -= 1;
      result += " ";
      continue;
    }
    if (quote !== undefined) {
      if (quote === '"' && character === "$" && command[index + 1] === "(") {
        const closing = findCommandSubstitutionEnd(command, index + 2);
        if (closing !== undefined) {
          result += `( ${visibleShellText(command.slice(index + 2, closing))} )`;
          index = closing;
          continue;
        }
      }
      if (quote === '"' && character === "`") {
        const closing = command.indexOf("`", index + 1);
        if (closing !== -1) {
          result += `( ${visibleShellText(command.slice(index + 1, closing))} )`;
          index = closing;
          continue;
        }
      }
      if (quote === '"' && character === "\\") {
        result += " ".repeat(Math.min(2, command.length - index));
        index += 1;
      } else {
        if (character === quote) quote = undefined;
        result += " ";
      }
      continue;
    }
    if (character === "=" && command[index + 1] === "(") {
      arrayDepth = 1;
      result += "  ";
      index += 1;
    } else if (character === "`") {
      const closing = command.indexOf("`", index + 1);
      if (closing === -1) {
        result += " ";
      } else {
        result += `( ${visibleShellText(command.slice(index + 1, closing))} )`;
        index = closing;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      result += " ";
    } else if (character === "\\") {
      result += " ".repeat(Math.min(2, command.length - index));
      index += 1;
    } else if (
      character === "#" &&
      (index === 0 || /[\s;|&(){}]/u.test(command[index - 1] ?? ""))
    ) {
      comment = true;
      result += " ";
    } else {
      result += character;
    }
  }
  return result;
};

const findCommandSubstitutionEnd = (command: string, start: number): number | undefined => {
  let depth = 1;
  let quote: "'" | '"' | undefined;
  let comment = false;
  for (let index = start; index < command.length; index += 1) {
    const character = command[index];
    if (comment) {
      if (character === "\n") comment = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (
      character === "#" &&
      (index === start || /[\s;|&(){}]/u.test(command[index - 1] ?? ""))
    ) {
      comment = true;
    } else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
};

const shellCommandEndPattern = /[\n;|&{}]/u;
const nonExecutingArgumentPattern = /(?:^|\s)(?:-h|--help|--version|--completions)(?=\s|=|$)/u;

export const countVisibleChangeSubmits = (command: string): number => {
  const visible = visibleShellText(command);
  return [...visible.matchAll(submitCommandPattern)].filter((match) => {
    const tail = visible.slice((match.index ?? 0) + match[0].length);
    const commandEnd = tail.search(shellCommandEndPattern);
    const argumentsText = commandEnd === -1 ? tail : tail.slice(0, commandEnd);
    return !nonExecutingArgumentPattern.test(argumentsText);
  }).length;
};

export const containsVisibleChangeSubmit = (command: string): boolean =>
  countVisibleChangeSubmits(command) > 0;

const initialSubmissionReassessmentMessage =
  "But Why blocked the complete Bash tool call before any part of it executed. Before the first Submission, re-read the complete current Acceptance Context and reassess the complete committed implementation against it. Correct and commit any material omissions you identify, run focused verification for those corrections, and then retry Change Submit.";

const inspectionFailureMessage = (message: string): string =>
  `But Why blocked Change Submission because trusted Change inspection could not determine whether initial Submission requires reassessment: ${message}`;

const findChangeId = (entries: readonly SessionEntry[]): string | undefined => {
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const text =
      typeof entry.message.content === "string"
        ? entry.message.content
        : entry.message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
    const found = extractChangeId(text);
    if (found !== undefined) return found;
  }
  return undefined;
};

export const decideContinuation = (
  snapshot: ChangeInspectionSnapshot,
  git?: { readonly head: string; readonly status: string },
): ContinuationDecision => {
  if (snapshot.change.state === "closed" || snapshot.toolingFailureCount > 0) {
    return { kind: "idle" };
  }
  if (snapshot.findingCount > 0) return { kind: "findings" };
  const publication = snapshot.publication;
  const currentCandidate = snapshot.currentCandidate;
  const hasOwnedPullRequest =
    git !== undefined &&
    publication?.pullRequest !== null &&
    publication?.pullRequest !== undefined &&
    currentCandidate !== null &&
    currentCandidate.id === publication.candidateId &&
    currentCandidate.headSha === publication.expectedHeadSha &&
    git.head === publication.expectedHeadSha &&
    git.status.trim() === "";
  if (hasOwnedPullRequest) return { kind: "idle" };
  return { kind: "general" };
};

export const buildContinuationMessage = (
  decision: ContinuationDecision,
  changeId: string,
): string => {
  if (decision.kind === "idle") return "";
  if (decision.kind === "findings") {
    return [
      `The Change ${changeId} has Findings.`,
      `Inspect the Findings with \`${butWhyCommand("change", "findings", changeId)}\`, fix every applicable problem in the Managed Worktree, commit the fixes, and submit again with \`${butWhyCommand("change", "submit", changeId)}\`.`,
    ].join(" ");
  }
  return [
    `Resume implementation of Change ${changeId}.`,
    `Inspect \`${butWhyCommand("change", "show", changeId)}\`, including its complete Acceptance Context when present, and the Managed Worktree.`,
    "Implement the complete accepted intent and continue until Change Submit passes.",
  ].join(" ");
};

export const nextRetryState = (previous: RetryState, fingerprint: string): RetryState =>
  fingerprint === previous.fingerprint
    ? { fingerprint, unchangedRestarts: previous.unchangedRestarts + 1 }
    : { fingerprint, unchangedRestarts: 0 };

const durableChangeFingerprint = (
  snapshot: ChangeInspectionSnapshot,
  blockerHistory: BlockerHistory,
  git: GitInspection,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        git,
        change: snapshot.change,
        currentCandidate: snapshot.currentCandidate,
        currentValidationRun: snapshot.currentValidationRun,
        findingCount: snapshot.findingCount,
        toolingFailureCount: snapshot.toolingFailureCount,
        pullRequest: snapshot.pullRequest,
        publication: snapshot.publication,
        cleanup: snapshot.cleanup,
        blockerHistory,
      }),
    )
    .digest("hex");

export const runContinueChange = (pi: ContinueChangeCapabilities): void => {
  let changeId: string | undefined;
  let persisted: PersistedContinuationState | undefined;
  let settling = false;
  let pauseGeneration = 0;
  let shutDown = false;
  let blockerAbortRequested = false;
  let activeInspectionAbortController: AbortController | undefined;
  let pollingTimer: ReturnType<typeof setTimeout> | undefined;
  let watcherDisplay: WatcherDisplay = { kind: "implementing", pullRequestUrl: null };

  const showWatcher = (ctx: ContinueChangeContext, display: WatcherDisplay): void => {
    watcherDisplay = display;
    if (changeId === undefined) {
      ctx.ui.setWidget(undefined);
      return;
    }
    const text = (() => {
      switch (display.kind) {
        case "implementing":
          return `● Implementing revision${display.pullRequestUrl === null ? "" : ` - ${display.pullRequestUrl}`}`;
        case "validating":
          return `◐ Validating revision${display.pullRequestUrl === null ? "" : ` - ${display.pullRequestUrl}`}`;
        case "checking":
          return "◐ Checking Change state…";
        case "paused":
          return "○ Paused";
        case "complete":
          return "✓ Change is complete";
        case "cancelled":
          return "✕ Change was cancelled";
        case "cleanup-needed":
          return "! Change cleanup is needed";
        case "idle":
          return "✓ No action needed";
        case "blocked":
          return "! Change is blocked";
        case "inspection-failed":
          return "! Change inspection failed";
        case "stopped":
          return "! Watching stopped - no progress";
        case "waiting-for-human-review":
          return `◌ Waiting for human review - ${display.pullRequestUrl}`;
      }
    })();
    ctx.ui.setWidget((_tui, theme) => ({
      render(width) {
        return [
          theme.fg(
            display.kind === "paused" || display.kind === "inspection-failed"
              ? "warning"
              : display.kind === "blocked" ||
                  display.kind === "stopped" ||
                  display.kind === "cancelled" ||
                  display.kind === "cleanup-needed"
                ? "error"
                : display.kind === "complete" ||
                    display.kind === "idle" ||
                    display.kind === "waiting-for-human-review"
                  ? "success"
                  : display.kind === "checking" || display.kind === "validating"
                    ? "muted"
                    : "accent",
            text.slice(0, Math.max(width, 0)),
          ),
        ];
      },
      invalidate() {},
    }));
  };

  const publicationPullRequestUrl = (snapshot: ChangeInspectionSnapshot): string | null => {
    const pullRequest = snapshot.publication?.pullRequest;
    if (pullRequest === null || pullRequest === undefined) return null;
    const url = Reflect.get(pullRequest, "url");
    return typeof url === "string" ? url : null;
  };

  const displayFor = (
    snapshot: ChangeInspectionSnapshot,
    git: GitInspection,
    blockerHistory: BlockerHistory,
  ): WatcherDisplay => {
    if (snapshot.change.state === "closed") {
      if (snapshot.cleanup?.state === "pending") return { kind: "cleanup-needed" };
      return snapshot.change.closeReason === "cancelled"
        ? { kind: "cancelled" }
        : { kind: "complete" };
    }
    if (blockerHistory.active !== null) return { kind: "blocked" };
    if (snapshot.toolingFailureCount > 0) return { kind: "stopped" };
    const pullRequestUrl = publicationPullRequestUrl(snapshot);
    if (snapshot.currentValidationRun?.state === "running") {
      return { kind: "validating", pullRequestUrl };
    }
    const decision = decideContinuation(snapshot, git);
    if (decision.kind === "idle") {
      const publication = snapshot.publication;
      const currentCandidate = snapshot.currentCandidate;
      if (
        publication?.pullRequest !== null &&
        publication?.pullRequest !== undefined &&
        currentCandidate !== null &&
        currentCandidate.id === publication.candidateId &&
        currentCandidate.headSha === publication.expectedHeadSha &&
        git.head === publication.expectedHeadSha &&
        git.status.trim() === ""
      ) {
        return pullRequestUrl === null
          ? { kind: "idle" }
          : { kind: "waiting-for-human-review", pullRequestUrl };
      }
      return { kind: "idle" };
    }
    return { kind: "implementing", pullRequestUrl };
  };

  const restoreState = (ctx: ContinueChangeContext): void => {
    const latest = ctx.sessionManager
      .getBranch()
      .filter(
        (entry): entry is Extract<SessionEntry, { type: "custom" }> =>
          entry.type === "custom" && entry.customType === stateEntry,
      )
      .at(-1);
    if (!isPersistedState(latest?.data)) return;
    if (changeId !== undefined && latest.data.changeId !== changeId) return;
    persisted = latest.data;
    changeId ??= latest.data.changeId;
  };

  const saveState = (state: PersistedContinuationState): void => {
    persisted = state;
    pi.appendContinuationState(state);
  };

  const run = async (
    command: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RunResult> => {
    const label = [command, ...args].join(" ");
    try {
      const result = await pi.exec(command, [...args], {
        cwd,
        timeout: 15_000,
        ...(signal === undefined ? {} : { signal }),
      });
      if (result.code === 0) return { ok: true, stdout: result.stdout };
      const stderr = result.stderr.trim();
      return {
        ok: false,
        transient: result.killed,
        message: `${label} exited with code ${result.code}${stderr === "" ? "" : `: ${stderr.slice(0, 500)}`}`,
        stdout: result.stdout,
      };
    } catch (error) {
      return {
        ok: false,
        transient: true,
        message: `${label} could not run: ${error instanceof Error ? error.message : String(error)}`,
        stdout: "",
      };
    }
  };

  const inspectCommand = (
    commandArgs: readonly string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RunResult> => run("by", commandArgs, cwd, signal);

  const inspectBlockerHistory = async (
    ctx: ContinueChangeContext,
    id: string,
    signal?: AbortSignal,
  ): Promise<BlockerInspectionResult> => {
    const result = await inspectCommand(["change", "blocker", "list", id], ctx.cwd, signal);
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.stdout.trim() === ""
            ? result.message
            : `${result.message}: ${result.stdout.trim().slice(0, 500)}`,
      };
    }
    try {
      const value = JSON.parse(result.stdout) as unknown;
      if (!isBlockerHistory(value, id)) {
        return {
          ok: false,
          message: "But Why inspection returned an unsupported blocker history shape",
        };
      }
      return { ok: true, blockerHistory: value };
    } catch {
      return { ok: false, message: "But Why inspection returned malformed blocker JSON" };
    }
  };

  const inspect = async (
    ctx: ContinueChangeContext,
    id: string,
    signal?: AbortSignal,
  ): Promise<InspectionResult> => {
    const args = ["change", "show", id];
    const blockerArgs = ["change", "blocker", "list", id];
    const [
      changeResult,
      blockerResult,
      headResult,
      statusResult,
      unstagedResult,
      stagedResult,
      untrackedResult,
    ] = await Promise.all([
      inspectCommand(args, ctx.cwd, signal),
      inspectCommand(blockerArgs, ctx.cwd, signal),
      run("git", ["rev-parse", "HEAD"], ctx.cwd, signal),
      run("git", ["status", "--porcelain=v1", "--untracked-files=all"], ctx.cwd, signal),
      run("git", ["diff", "--no-ext-diff", "--binary"], ctx.cwd, signal),
      run("git", ["diff", "--cached", "--no-ext-diff", "--binary"], ctx.cwd, signal),
      run("git", ["ls-files", "--others", "--exclude-standard", "-z"], ctx.cwd, signal),
    ]);
    const results = [
      changeResult,
      blockerResult,
      headResult,
      statusResult,
      unstagedResult,
      stagedResult,
      untrackedResult,
    ];
    if (results.some((result) => !result.ok)) {
      const failures = results.filter(
        (result): result is Extract<RunResult, { readonly ok: false }> => !result.ok,
      );
      return {
        ok: false,
        transient: failures.every((failure) => failure.transient),
        message: failures
          .map((failure) =>
            failure.stdout.trim() === ""
              ? failure.message
              : `${failure.message}: ${failure.stdout.trim().slice(0, 500)}`,
          )
          .join("; "),
      };
    }

    const untrackedPaths = untrackedResult.stdout.split("\0").filter((path) => path !== "");
    const untrackedHashResult =
      untrackedPaths.length === 0
        ? ({ ok: true, stdout: "" } as const)
        : await run("git", ["hash-object", "--", ...untrackedPaths], ctx.cwd, signal);
    if (!untrackedHashResult.ok) {
      return {
        ok: false,
        transient: untrackedHashResult.transient,
        message: untrackedHashResult.message,
      };
    }

    let snapshotValue: unknown;
    let blockerValue: unknown;
    try {
      snapshotValue = JSON.parse(changeResult.stdout) as unknown;
      blockerValue = JSON.parse(blockerResult.stdout) as unknown;
    } catch {
      return { ok: false, transient: false, message: "But Why inspection returned malformed JSON" };
    }
    if (!isSnapshot(snapshotValue)) {
      return {
        ok: false,
        transient: false,
        message: "But Why inspection returned an unsupported Change state shape",
      };
    }
    if (!isBlockerHistory(blockerValue, id)) {
      return {
        ok: false,
        transient: false,
        message: "But Why inspection returned an unsupported blocker history shape",
      };
    }
    const untrackedHashes = untrackedHashResult.stdout.split("\n").filter((hash) => hash !== "");
    const git: GitInspection = {
      head: headResult.stdout.trim(),
      status: statusResult.stdout,
      unstagedDiff: unstagedResult.stdout,
      stagedDiff: stagedResult.stdout,
      untrackedFiles: untrackedPaths.map((path, index) => ({
        path,
        hash: untrackedHashes[index] ?? "",
      })),
    };
    return {
      ok: true,
      snapshot: snapshotValue,
      blockerHistory: blockerValue,
      fingerprint: durableChangeFingerprint(snapshotValue, blockerValue, git),
      git,
    };
  };

  const inspectInitialSubmissionEligibility = async (
    ctx: ContinueChangeContext,
    id: string,
  ): Promise<
    | { readonly ok: true; readonly hasAcceptanceContext: boolean }
    | { readonly ok: false; readonly message: string }
  > => {
    const changeResult = await inspectCommand(["change", "show", id], ctx.cwd);
    if (!changeResult.ok) {
      return {
        ok: false,
        message:
          changeResult.stdout.trim() === ""
            ? changeResult.message
            : `${changeResult.message}: ${changeResult.stdout.trim().slice(0, 500)}`,
      };
    }

    let snapshotValue: unknown;
    try {
      snapshotValue = JSON.parse(changeResult.stdout) as unknown;
    } catch {
      return { ok: false, message: "But Why Change inspection returned malformed JSON" };
    }
    if (!isSnapshot(snapshotValue)) {
      return {
        ok: false,
        message: "But Why inspection returned an unsupported Change state shape",
      };
    }
    return {
      ok: true,
      hasAcceptanceContext: snapshotValue.change.acceptanceContext !== null,
    };
  };

  const markInitialSubmissionHandled = (): void => {
    if (changeId === undefined) return;
    const previous = persisted ?? {
      changeId,
      fingerprint: "inspection-unavailable",
      unchangedRestarts: 0,
      paused: false,
      resolutionBlockerId: null,
    };
    saveState({ ...previous, initialSubmissionHandled: true });
  };

  const showValidationStarted = (ctx: ContinueChangeContext): void => {
    const pullRequestUrl =
      watcherDisplay.kind === "implementing" ||
      watcherDisplay.kind === "validating" ||
      watcherDisplay.kind === "waiting-for-human-review"
        ? watcherDisplay.pullRequestUrl
        : null;
    showWatcher(ctx, { kind: "validating", pullRequestUrl });
  };

  pi.onToolCall(async (event, ctx) => {
    if (!containsVisibleChangeSubmit(event.input.command)) return;
    if (persisted?.initialSubmissionHandled === true) {
      showValidationStarted(ctx);
      return;
    }
    if (changeId === undefined) {
      return {
        block: true,
        reason: inspectionFailureMessage("this Implementer session has no bound Change identity"),
      };
    }

    const eligibility = await inspectInitialSubmissionEligibility(ctx, changeId);
    if (!eligibility.ok) {
      return { block: true, reason: inspectionFailureMessage(eligibility.message) };
    }
    if (!eligibility.hasAcceptanceContext) {
      markInitialSubmissionHandled();
      showValidationStarted(ctx);
      return;
    }
    pi.sendUserMessage(initialSubmissionReassessmentMessage, { deliverAs: "steer" });
    markInitialSubmissionHandled();
    return { block: true, reason: initialSubmissionReassessmentMessage };
  });

  const latestResolution = (history: BlockerHistory): BlockerResolution | null =>
    history.resolutions.at(-1) ?? null;

  const resolutionBlockerId = (resolution: BlockerResolution | null): number | null =>
    resolution?.blockerId ?? null;

  const reconcileContinuationState = (
    id: string,
    observed: Extract<InspectionResult, { readonly ok: true }>,
    previous: PersistedContinuationState | undefined,
    retry: RetryState,
    mode: "initialize" | "resume",
  ): {
    readonly state: PersistedContinuationState;
    readonly resolution: BlockerResolution | null;
  } => {
    const latest = latestResolution(observed.blockerHistory);
    const latestBlockerId = resolutionBlockerId(latest);
    const handledBlockerId = previous?.resolutionBlockerId ?? null;
    const resolutionChanged =
      latestBlockerId !== null &&
      (mode === "initialize"
        ? latestBlockerId !== handledBlockerId
        : previous?.resolutionBlockerId !== undefined &&
          latestBlockerId !== previous.resolutionBlockerId);
    const pendingBlockerId = resolutionChanged
      ? latestBlockerId
      : (previous?.pendingResolutionBlockerId ?? null);
    const state: PersistedContinuationState = {
      changeId: id,
      ...retry,
      paused: false,
      resolutionBlockerId:
        mode === "initialize" ? handledBlockerId : (handledBlockerId ?? latestBlockerId),
      pendingResolutionBlockerId: pendingBlockerId,
      ...(previous?.initialSubmissionHandled === undefined
        ? {}
        : { initialSubmissionHandled: previous.initialSubmissionHandled }),
    };
    const resolution = latest !== null && pendingBlockerId === latestBlockerId ? latest : null;
    return { state, resolution };
  };

  const markResolutionDelivered = (
    state: PersistedContinuationState,
    resolution: BlockerResolution,
  ): PersistedContinuationState => ({
    ...state,
    resolutionBlockerId: resolution.blockerId,
    pendingResolutionBlockerId: null,
  });

  const resolutionMessage = (
    id: string,
    resolution: BlockerResolution,
    hasFindings: boolean,
  ): string => {
    const explanation = resolution.content;
    const next = hasFindings
      ? `Now inspect the earlier Findings with \`${butWhyCommand("change", "findings", id)}\`, fix every applicable problem in the Managed Worktree, commit the fixes, and submit again with \`${butWhyCommand("change", "submit", id)}\`.`
      : `Now inspect \`${butWhyCommand("change", "show", id)}\`, including its complete Acceptance Context when present, and the Managed Worktree. Continue implementing the complete accepted intent until Change Submit passes.`;
    return `An Implementation Blocker Resolution was recorded for Change ${id}: ${explanation} ${next}`;
  };

  const validationFailureMessage = (id: string, snapshot: ChangeInspectionSnapshot): string => {
    const runId = snapshot.currentValidationRun?.id;
    const detail =
      runId !== undefined
        ? `Inspect the Validation Tooling Failure with \`${butWhyCommand("validation-run", "show", String(runId))}\`.`
        : `Inspect the Validation Tooling Failure with \`${butWhyCommand("change", "show", id)}\`.`;
    return `The Change ${id} has a Validation Tooling Failure. ${detail} Recover the validation tooling, then submit the Change again with \`${butWhyCommand("change", "submit", id)}\`.`;
  };

  const clearBlockedPolling = (): void => {
    if (pollingTimer !== undefined) clearTimeout(pollingTimer);
    pollingTimer = undefined;
  };

  let continueWatching: (ctx: ContinueChangeContext, explicit: boolean) => Promise<void>;

  const scheduleBlockedPolling = (ctx: ContinueChangeContext): void => {
    clearBlockedPolling();
    if (shutDown || persisted?.paused) return;
    pollingTimer = setTimeout(() => {
      pollingTimer = undefined;
      void continueWatching(ctx, false);
    }, blockerPollingIntervalMs);
    if (typeof pollingTimer === "object") pollingTimer.unref();
  };

  const initialize = async (ctx: ContinueChangeContext): Promise<void> => {
    if (changeId === undefined) {
      ctx.ui.setWidget(undefined);
      return;
    }
    if (persisted?.paused) {
      showWatcher(ctx, { kind: "paused" });
      return;
    }
    showWatcher(ctx, { kind: "checking" });
    const observed = await inspect(ctx, changeId);
    if (shutDown) return;
    if (!observed.ok) {
      showWatcher(ctx, { kind: "inspection-failed" });
      return;
    }
    const reconciliation = reconcileContinuationState(
      changeId,
      observed,
      persisted,
      { fingerprint: observed.fingerprint, unchangedRestarts: 0 },
      "initialize",
    );
    saveState(reconciliation.state);
    showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
    if (observed.blockerHistory.active !== null && observed.snapshot.change.state === "open") {
      scheduleBlockedPolling(ctx);
      return;
    }
    clearBlockedPolling();
    if (
      reconciliation.resolution !== null &&
      observed.snapshot.change.state === "open" &&
      ctx.isIdle()
    ) {
      saveState(markResolutionDelivered(reconciliation.state, reconciliation.resolution));
      showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
      pi.sendUserMessage(
        resolutionMessage(changeId, reconciliation.resolution, observed.snapshot.findingCount > 0),
      );
    }
  };

  const pause = (ctx: ContinueChangeContext): void => {
    if (changeId === undefined) {
      ctx.ui.notify(
        "But Why automatic continuation is unavailable because this session has no Change.",
        "warning",
      );
      return;
    }
    pauseGeneration += 1;
    clearBlockedPolling();
    activeInspectionAbortController?.abort();
    const state = persisted ?? {
      changeId,
      fingerprint: "inspection-unavailable",
      unchangedRestarts: 0,
      paused: false,
      resolutionBlockerId: null,
    };
    saveState({ ...state, paused: true });
    showWatcher(ctx, { kind: "paused" });
    ctx.ui.notify(
      "But Why Change continuation is paused. Discuss the Change, then run /continue-change to refresh and continue.",
      "info",
    );
  };

  continueWatching = async (ctx: ContinueChangeContext, explicit: boolean): Promise<void> => {
    if (!ctx.isIdle() || settling) {
      if (!persisted?.paused && watcherDisplay.kind === "blocked") scheduleBlockedPolling(ctx);
      return;
    }
    if (changeId === undefined) {
      showWatcher(ctx, { kind: "implementing", pullRequestUrl: null });
      return;
    }
    if (!explicit && persisted?.paused) {
      showWatcher(ctx, { kind: "paused" });
      return;
    }
    const id = changeId;
    const startedAtPauseGeneration = pauseGeneration;
    const wasBlocked = watcherDisplay.kind === "blocked";
    const inspectionAbortController = new AbortController();
    activeInspectionAbortController = inspectionAbortController;
    settling = true;
    showWatcher(ctx, { kind: "checking" });
    try {
      const observed = await inspect(ctx, id, inspectionAbortController.signal);
      if (shutDown) return;
      if (persisted?.paused || startedAtPauseGeneration !== pauseGeneration) {
        showWatcher(ctx, { kind: "paused" });
        return;
      }
      if (!observed.ok) {
        const previous = persisted ?? {
          changeId: id,
          fingerprint: "inspection-unavailable",
          unchangedRestarts: 0,
          paused: false,
          resolutionBlockerId: null,
        };
        if (!observed.transient) {
          saveState({ ...previous, paused: true });
          showWatcher(ctx, { kind: "inspection-failed" });
          ctx.ui.notify(
            `But Why inspection requires operator recovery and is paused: ${observed.message}`,
            "warning",
          );
          return;
        }
        const retry = {
          fingerprint: previous.fingerprint,
          unchangedRestarts: previous.unchangedRestarts + 1,
        };
        if (!wasBlocked && retry.unchangedRestarts > maxUnchangedRestarts) {
          saveState({ ...previous, ...retry, paused: false });
          showWatcher(ctx, { kind: "stopped" });
          ctx.ui.notify(
            "But Why automatic continuation stopped after three inspection failures without durable state progress. Restore CLI and Git access, then take the next action manually.",
            "warning",
          );
          return;
        }
        saveState({ ...previous, ...retry, paused: false });
        showWatcher(ctx, { kind: "inspection-failed" });
        ctx.ui.notify(
          "But Why could not inspect the current Change state; automatic continuation will keep trying until inspection recovers or the operator pauses it.",
          "warning",
        );
        if (wasBlocked) {
          showWatcher(ctx, { kind: "blocked" });
          scheduleBlockedPolling(ctx);
        }
        if (!explicit && !wasBlocked && ctx.isIdle()) {
          pi.sendUserMessage(
            `But Why could not inspect the current Change state for ${id}. Restore But Why CLI and Git access, then inspect the Change and Managed Worktree and continue. Do not assume a stopping condition.`,
          );
        }
        return;
      }

      const previous = persisted ?? {
        changeId: id,
        fingerprint: observed.fingerprint,
        unchangedRestarts: 0,
        paused: false,
        resolutionBlockerId: null,
      };
      const retry = explicit
        ? { fingerprint: observed.fingerprint, unchangedRestarts: 0 }
        : nextRetryState(previous, observed.fingerprint);
      const reconciliation = reconcileContinuationState(id, observed, previous, retry, "resume");
      saveState(reconciliation.state);

      if (observed.blockerHistory.active !== null && observed.snapshot.change.state === "open") {
        showWatcher(ctx, { kind: "blocked" });
        scheduleBlockedPolling(ctx);
        return;
      }
      clearBlockedPolling();
      if (reconciliation.resolution !== null) {
        if (observed.snapshot.change.state === "open") {
          saveState(markResolutionDelivered(reconciliation.state, reconciliation.resolution));
          showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
          pi.sendUserMessage(
            resolutionMessage(id, reconciliation.resolution, observed.snapshot.findingCount > 0),
          );
        } else {
          showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
        }
        return;
      }
      if (explicit && observed.snapshot.toolingFailureCount > 0) {
        showWatcher(ctx, { kind: "stopped" });
        pi.sendUserMessage(validationFailureMessage(id, observed.snapshot));
        return;
      }

      const decision = decideContinuation(observed.snapshot, observed.git);
      if (decision.kind === "idle") {
        if (
          explicit &&
          observed.snapshot.change.state === "open" &&
          observed.snapshot.publication?.pullRequest !== null &&
          observed.snapshot.publication?.pullRequest !== undefined
        ) {
          showWatcher(ctx, {
            kind: "implementing",
            pullRequestUrl: publicationPullRequestUrl(observed.snapshot),
          });
          pi.sendUserMessage(
            `The Change ${id} has a Candidate ready for human review. Resume revision work in the Managed Worktree under the operator's direct instruction. Record new Implementation Decisions when needed, commit the revised Candidate, and run ${butWhyCommand("change", "submit", id)} before publication.`,
          );
        } else {
          showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
        }
        return;
      }
      if (!explicit && retry.unchangedRestarts > maxUnchangedRestarts) {
        showWatcher(ctx, { kind: "stopped" });
        ctx.ui.notify(
          "But Why automatic continuation stopped after three restarts without Git or Change progress. Take the next action manually.",
          "warning",
        );
        return;
      }
      const message = buildContinuationMessage(decision, id);
      showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
      if (ctx.isIdle()) pi.sendUserMessage(message);
    } finally {
      if (activeInspectionAbortController === inspectionAbortController) {
        activeInspectionAbortController = undefined;
      }
      settling = false;
      if (!shutDown && watcherDisplay.kind === "checking") {
        showWatcher(ctx, { kind: "implementing", pullRequestUrl: null });
      }
    }
  };

  pi.onSessionStart(async (ctx) => {
    changeId ??= findChangeId(ctx.sessionManager.getBranch());
    restoreState(ctx);
    await initialize(ctx);
  });

  pi.registerCommand("pause-change", {
    description: "Pause automatic Change continuation",
    handler: async (_args, ctx) => pause(ctx),
  });

  pi.registerCommand("continue-change", {
    description: "Resume automatic continuation and refresh the Change",
    handler: async (_args, ctx) => {
      if (changeId === undefined) {
        ctx.ui.notify(
          "But Why automatic continuation is unavailable because this session has no Change.",
          "warning",
        );
        return;
      }
      if (settling) {
        ctx.ui.notify("But Why Change inspection is already in progress.", "info");
        return;
      }
      if (persisted?.paused) {
        pauseGeneration += 1;
        saveState({ ...persisted, paused: false, unchangedRestarts: 0 });
      }
      await continueWatching(ctx, true);
    },
  });

  pi.onInput((event, ctx) => {
    if (event.source === "extension") return;
    const inputChangeId = extractChangeId(event.text);
    if (inputChangeId === undefined || changeId !== undefined) return;
    changeId = inputChangeId;
    showWatcher(
      ctx,
      persisted?.paused ? { kind: "paused" } : { kind: "implementing", pullRequestUrl: null },
    );
  });

  pi.onSessionShutdown(() => {
    shutDown = true;
    pauseGeneration += 1;
    clearBlockedPolling();
    activeInspectionAbortController?.abort();
    activeInspectionAbortController = undefined;
  });

  pi.onTurnEnd(async (event, ctx) => {
    if (!event.hasToolResults) return;
    if (changeId === undefined || shutDown || persisted?.paused || blockerAbortRequested) return;
    const observed = await inspectBlockerHistory(ctx, changeId, ctx.signal);
    if (shutDown || persisted?.paused || ctx.signal?.aborted) return;
    if (!observed.ok) {
      blockerAbortRequested = true;
      pause(ctx);
      showWatcher(ctx, { kind: "inspection-failed" });
      ctx.ui.notify(
        `But Why trusted blocker inspection failed and automatic continuation is paused: ${observed.message}`,
        "warning",
      );
      ctx.abort();
      return;
    }
    if (observed.blockerHistory.active !== null) {
      blockerAbortRequested = true;
      showWatcher(ctx, { kind: "blocked" });
      ctx.abort();
    }
  });

  pi.onAgentEnd(async (event, ctx) => {
    const blockerAbortWasRequested = blockerAbortRequested;
    blockerAbortRequested = false;
    if (blockerAbortWasRequested) return;
    if (
      event.messages.some(
        (message) => message.role === "assistant" && message.stopReason === "aborted",
      ) &&
      changeId !== undefined
    ) {
      pause(ctx);
    }
  });

  pi.onAgentSettled(async (ctx) => {
    if (persisted?.paused) {
      await continueWatching(ctx, false);
      return;
    }
    await continueWatching(ctx, false);
  });
};

export default function continueChange(api: ExtensionAPI): void {
  runContinueChange(adaptExtensionApi(api));
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isOptionalNullablePositiveInteger = (value: unknown): value is number | null | undefined =>
  value === undefined || value === null || isPositiveInteger(value);

const isPersistedState = (value: unknown): value is PersistedContinuationState =>
  isRecord(value) &&
  typeof recordValue(value, "changeId") === "string" &&
  typeof recordValue(value, "fingerprint") === "string" &&
  isNonNegativeInteger(recordValue(value, "unchangedRestarts")) &&
  typeof recordValue(value, "paused") === "boolean" &&
  isOptionalNullablePositiveInteger(recordValue(value, "resolutionBlockerId")) &&
  isOptionalNullablePositiveInteger(recordValue(value, "pendingResolutionBlockerId")) &&
  (recordValue(value, "initialSubmissionHandled") === undefined ||
    typeof recordValue(value, "initialSubmissionHandled") === "boolean");

const isCandidate = (value: unknown): value is CurrentCandidate =>
  isRecord(value) &&
  isPositiveInteger(recordValue(value, "id")) &&
  typeof recordValue(value, "headSha") === "string";

const isValidationRun = (value: unknown): value is CurrentValidationRun =>
  isRecord(value) &&
  isPositiveInteger(recordValue(value, "id")) &&
  (recordValue(value, "state") === "running" || recordValue(value, "state") === "complete");

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isAcceptanceContext = (value: unknown): value is JsonObject | null =>
  value === null ||
  (isRecord(value) &&
    recordValue(value, "version") === 1 &&
    typeof recordValue(value, "title") === "string" &&
    typeof recordValue(value, "description") === "string" &&
    (recordValue(value, "comments") === undefined ||
      isStringArray(recordValue(value, "comments"))) &&
    (recordValue(value, "resolutions") === undefined ||
      isStringArray(recordValue(value, "resolutions"))));

const isSnapshot = (value: unknown): value is ChangeInspectionSnapshot => {
  if (!isRecord(value)) return false;
  const change = recordValue(value, "change");
  const candidate = recordValue(value, "currentCandidate");
  const validationRun = recordValue(value, "currentValidationRun");
  const publication = recordValue(value, "publication");
  const cleanup = recordValue(value, "cleanup");
  return (
    isRecord(change) &&
    (recordValue(change, "state") === "open" || recordValue(change, "state") === "closed") &&
    (recordValue(change, "closeReason") === "completed" ||
      recordValue(change, "closeReason") === "cancelled" ||
      recordValue(change, "closeReason") === null) &&
    isAcceptanceContext(recordValue(change, "acceptanceContext")) &&
    (candidate === null || isCandidate(candidate)) &&
    (validationRun === null || isValidationRun(validationRun)) &&
    isNonNegativeInteger(recordValue(value, "findingCount")) &&
    isNonNegativeInteger(recordValue(value, "toolingFailureCount")) &&
    (recordValue(value, "pullRequest") === null || isRecord(recordValue(value, "pullRequest"))) &&
    (cleanup === undefined ||
      (isRecord(cleanup) &&
        (recordValue(cleanup, "state") === "complete" ||
          recordValue(cleanup, "state") === "pending"))) &&
    (publication === undefined ||
      publication === null ||
      (isRecord(publication) &&
        isPositiveInteger(recordValue(publication, "candidateId")) &&
        typeof recordValue(publication, "expectedHeadSha") === "string" &&
        (recordValue(publication, "pullRequest") === null ||
          isRecord(recordValue(publication, "pullRequest")))))
  );
};

const isResolution = (value: unknown): value is BlockerResolution =>
  isRecord(value) &&
  isPositiveInteger(recordValue(value, "blockerId")) &&
  typeof recordValue(value, "content") === "string";

const isImplementationBlocker = (value: unknown): value is ImplementationBlocker =>
  isRecord(value) &&
  isPositiveInteger(recordValue(value, "id")) &&
  typeof recordValue(value, "changeId") === "string" &&
  typeof recordValue(value, "content") === "string" &&
  (recordValue(value, "resolution") === null || isResolution(recordValue(value, "resolution")));

const sameResolution = (left: BlockerResolution, right: BlockerResolution): boolean =>
  left.blockerId === right.blockerId && left.content === right.content;

const sameBlocker = (left: ImplementationBlocker, right: ImplementationBlocker): boolean =>
  left.id === right.id &&
  left.changeId === right.changeId &&
  left.content === right.content &&
  ((left.resolution === null && right.resolution === null) ||
    (left.resolution !== null &&
      right.resolution !== null &&
      sameResolution(left.resolution, right.resolution)));

const isBlockerHistory = (value: unknown, changeId: string): value is BlockerHistory => {
  if (!isRecord(value)) return false;
  const blockersValue = recordValue(value, "blockers");
  const resolutionsValue = recordValue(value, "resolutions");
  const activeValue = recordValue(value, "active");
  if (
    !Array.isArray(blockersValue) ||
    !blockersValue.every(isImplementationBlocker) ||
    !Array.isArray(resolutionsValue) ||
    !resolutionsValue.every(isResolution) ||
    (activeValue !== null && !isImplementationBlocker(activeValue))
  ) {
    return false;
  }
  const blockers = blockersValue;
  const resolutions = resolutionsValue;
  if (blockers.some((blocker) => blocker.changeId !== changeId)) return false;
  if (new Set(blockers.map((blocker) => blocker.id)).size !== blockers.length) return false;
  if (
    blockers.some((blocker, index) => {
      const previous = index > 0 ? blockers[index - 1] : undefined;
      return previous !== undefined && previous.id >= blocker.id;
    })
  ) {
    return false;
  }
  if (new Set(resolutions.map((resolution) => resolution.blockerId)).size !== resolutions.length) {
    return false;
  }
  if (
    resolutions.some((resolution, index) => {
      const previous = index > 0 ? resolutions[index - 1] : undefined;
      return previous !== undefined && previous.blockerId >= resolution.blockerId;
    })
  ) {
    return false;
  }
  const resolvedBlockers = blockers.filter((blocker) => blocker.resolution !== null);
  const activeBlockers = blockers.filter((blocker) => blocker.resolution === null);
  if (activeBlockers.length > 1 || resolutions.length !== resolvedBlockers.length) return false;
  for (const blocker of blockers) {
    if (blocker.resolution === null) continue;
    if (blocker.resolution.blockerId !== blocker.id) return false;
    const resolution = resolutions.find((item) => item.blockerId === blocker.id);
    if (resolution === undefined || !sameResolution(resolution, blocker.resolution)) return false;
  }
  if (activeValue === null) return activeBlockers.length === 0;
  const activeBlocker = activeBlockers[0];
  return (
    activeBlocker !== undefined &&
    activeValue.changeId === changeId &&
    activeValue.resolution === null &&
    sameBlocker(activeValue, activeBlocker)
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordValue = (record: Record<string, unknown>, key: string): unknown => record[key];
