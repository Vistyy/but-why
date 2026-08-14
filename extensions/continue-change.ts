import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ExtensionAPI,
  type ExtensionContext,
  isBashToolResult,
  isToolCallEventType,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

type ChangeState = "open" | "closed";
type ChangeCloseReason = "completed" | "cancelled";

type JsonObject = Readonly<Record<string, unknown>>;

type ChangeCleanup = JsonObject & {
  readonly state: "complete" | "pending";
};

type CurrentCandidate = JsonObject & {
  readonly id: string;
  readonly headSha: string;
};

type CurrentValidationRun = JsonObject & {
  readonly id: string;
  readonly state: "running" | "complete";
};

type BlockerResolution = JsonObject & {
  readonly id: string;
  readonly content: string;
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
    readonly candidateId: string;
    readonly expectedHeadSha: string;
    readonly pullRequest: Readonly<Record<string, unknown>> | null;
  } | null;
};

type BlockerHistory = {
  readonly blockers: readonly JsonObject[];
  readonly resolutions: readonly JsonObject[];
  readonly active: JsonObject | null;
};

export type ContinuationDecision =
  | { readonly kind: "findings" }
  | { readonly kind: "general" }
  | { readonly kind: "idle" };

export type RetryState = {
  readonly fingerprint: string;
  readonly unchangedRestarts: number;
};

type ReassessmentEvidence = {
  readonly change: boolean;
  readonly acceptanceContext: boolean;
  readonly worktreeStatus: boolean;
  readonly candidateDiff: boolean;
};

type SubmissionReassessment = {
  readonly state: "awaiting-settle" | "awaiting-restart" | "running" | "complete" | "not-required";
  readonly baseRef: string | null;
  readonly evidence: ReassessmentEvidence;
};

type PersistedContinuationState = RetryState & {
  readonly changeId: string;
  readonly paused: boolean;
  readonly resolutionId?: string | null;
  readonly pendingResolutionId?: string | null;
  readonly submissionReassessment?: SubmissionReassessment;
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

const stateEntry = "but-why-change-continuation";
const watcherWidget = "but-why-change-watcher";
const maxUnchangedRestarts = 3;
const blockerPollingIntervalMs = 30_000;
const changeIdPattern =
  /^\s*Change identity:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.?\s*$/imu;
type ButWhyCommandPrefix = "just by" | "npx -y but-why";

const defaultCommandPrefix: ButWhyCommandPrefix = "npx -y but-why";
const butWhyCommand = (prefix: ButWhyCommandPrefix, ...args: readonly string[]): string =>
  [prefix, ...args].join(" ");

export const extractChangeId = (text: string): string | undefined =>
  text.match(changeIdPattern)?.[1];

const submitCommandPattern =
  /(?:^|[\n;|&){}]|(?<!=)\()\s*(?:(?:if|then|elif|else|while|until|do|!)\s+)*(?:just\s+by|pnpx\s+but-why|npx\s+-y\s+but-why)\s+change\s+submit(?:\s|$)/gu;

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

const interruptedSubmissionMessage =
  "But Why blocked the complete Bash tool call before any part of it executed. The required reassessment starts after this agent run settles. Do not retry Change Submission in this run.";

const pendingReassessmentMessage =
  "But Why blocked Change Submission because the required separate reassessment run has not settled.";

const inspectionFailureMessage = (message: string): string =>
  `But Why blocked Change Submission because it could not classify reassessment eligibility from trusted Change inspection: ${message}`;

const emptyReassessmentEvidence = (): ReassessmentEvidence => ({
  change: false,
  acceptanceContext: false,
  worktreeStatus: false,
  candidateDiff: false,
});

const reassessmentEvidenceComplete = (reassessment: SubmissionReassessment): boolean =>
  reassessment.evidence.change &&
  reassessment.evidence.acceptanceContext &&
  reassessment.evidence.worktreeStatus &&
  reassessment.evidence.candidateDiff;

const commandReassessmentEvidence = (
  command: string,
  changeId: string,
  baseRef: string,
): ReassessmentEvidence => {
  const visible = visibleShellText(command).trim();
  const prefixes = ["just by", "pnpx but-why", "npx -y but-why"];
  return {
    change: prefixes.some((prefix) => visible === `${prefix} change show ${changeId}`),
    acceptanceContext: prefixes.some((prefix) => visible === `${prefix} change show ${changeId}`),
    worktreeStatus: visible === "git status --short",
    candidateDiff: visible === `git diff ${baseRef}...HEAD`,
  };
};

const incompleteReassessmentMessage = (
  reassessment: SubmissionReassessment,
  changeId: string,
  commandPrefix: ButWhyCommandPrefix,
): string => {
  const commands = [
    ...(!reassessment.evidence.change || !reassessment.evidence.acceptanceContext
      ? [butWhyCommand(commandPrefix, "change", "show", changeId)]
      : []),
    ...(reassessment.evidence.worktreeStatus ? [] : ["git status --short"]),
    ...(reassessment.evidence.candidateDiff || reassessment.baseRef === null
      ? []
      : [`git diff ${reassessment.baseRef}...HEAD`]),
  ];
  return `The reassessment cannot complete from confirmation alone. Continue the same reassessment run and successfully execute the missing required inspections: ${commands.map((command) => `\`${command}\``).join(", ")}. Then complete the comparison, corrections, commits, and focused verification required by the reassessment instructions.`;
};

const submissionReassessmentMessage = (
  changeId: string,
  commandPrefix: ButWhyCommandPrefix,
  baseRef: string,
): string =>
  [
    `But Why started the required separate reassessment run for Change ${changeId}.`,
    "Do not call Change Submit during this run.",
    `Inspect the Change with \`${butWhyCommand(commandPrefix, "change", "show", changeId)}\` and use its complete current Acceptance Context when present.`,
    "Inspect the Managed Worktree status with `git status --short`.",
    `Inspect the complete committed Candidate diff against the current Change Base with \`git diff ${baseRef}...HEAD\`.`,

    "Compare the complete committed implementation with every accepted outcome, criterion, constraint, and verification requirement.",
    "Correct and commit each material discrepancy.",
    "Run focused verification for any corrections.",
    "Do not run configured blocking Checks or reviews, a repository-wide quality command, or an unfiltered test or coverage workload.",
    "When the reassessment is complete, end this run without submitting. The extension will complete the reassessment boundary after this run settles and will permit later Submission attempts.",
  ].join(" ");

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
  commandPrefix: ButWhyCommandPrefix = defaultCommandPrefix,
): string => {
  if (decision.kind === "idle") return "";
  if (decision.kind === "findings") {
    return [
      `The Change ${changeId} has Findings.`,
      `Inspect the Findings with \`${butWhyCommand(commandPrefix, "change", "findings", changeId)}\`, fix every applicable problem in the Managed Worktree, commit the fixes, and submit again with \`${butWhyCommand(commandPrefix, "change", "submit", changeId)}\`.`,
    ].join(" ");
  }
  return [
    `Resume implementation of Change ${changeId}.`,
    `Inspect \`${butWhyCommand(commandPrefix, "change", "show", changeId)}\`, including its complete Acceptance Context when present, and the Managed Worktree.`,
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

export default function continueChange(pi: ExtensionAPI): void {
  let changeId: string | undefined;
  let persisted: PersistedContinuationState | undefined;
  let settling = false;
  let pauseGeneration = 0;
  let shutDown = false;
  let activeInspectionAbortController: AbortController | undefined;
  let pollingTimer: ReturnType<typeof setTimeout> | undefined;
  let watcherDisplay: WatcherDisplay = { kind: "implementing", pullRequestUrl: null };
  const pendingReassessmentEvidence = new Map<string, ReassessmentEvidence>();

  const showWatcher = (ctx: ExtensionContext, display: WatcherDisplay): void => {
    watcherDisplay = display;
    if (changeId === undefined) {
      ctx.ui.setWidget(watcherWidget, undefined);
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
    ctx.ui.setWidget(watcherWidget, (_tui, theme) => ({
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

  const restoreState = (ctx: ExtensionContext): void => {
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
    pi.appendEntry(stateEntry, state);
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

  const commandPrefixFor = (cwd: string): ButWhyCommandPrefix => {
    try {
      accessSync(join(cwd, "justfile"), constants.R_OK);
      accessSync(join(cwd, "bin/by"), constants.X_OK);
      const launcher = readFileSync(join(cwd, "bin/by"), "utf8");
      return launcher.includes("main_checkout_unavailable") &&
        launcher.includes("trusted_executable_unavailable")
        ? "just by"
        : "npx -y but-why";
    } catch {
      return "npx -y but-why";
    }
  };

  const cliInvocation = (
    prefix: ButWhyCommandPrefix,
    args: readonly string[],
  ): readonly [string, ...string[]] =>
    prefix === "just by" ? ["just", "by", ...args] : ["npx", "-y", "but-why", ...args];

  const inspectCommand = async (
    commandArgs: readonly string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RunResult> => {
    const prefix = commandPrefixFor(cwd);
    const [command, ...args] = cliInvocation(prefix, commandArgs);
    return run(command, args, cwd, signal);
  };

  const inspect = async (
    ctx: ExtensionContext,
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
    if (!isBlockerHistory(blockerValue)) {
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

  const inspectReassessmentEligibility = async (
    ctx: ExtensionContext,
    id: string,
  ): Promise<
    | {
        readonly ok: true;
        readonly hasAcceptanceContext: boolean;
        readonly baseRef: string | null;
      }
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
    if (snapshotValue.change.acceptanceContext === null) {
      return { ok: true, hasAcceptanceContext: false, baseRef: null };
    }
    if (snapshotValue.change.baseRef === undefined || snapshotValue.change.baseRef === null) {
      return { ok: false, message: "But Why inspection omitted the Change Base reference" };
    }
    return {
      ok: true,
      hasAcceptanceContext: true,
      baseRef: snapshotValue.change.baseRef,
    };
  };

  const saveSubmissionReassessment = (state: SubmissionReassessment): void => {
    if (changeId === undefined) return;
    const previous = persisted ?? {
      changeId,
      fingerprint: "inspection-unavailable",
      unchangedRestarts: 0,
      paused: false,
      resolutionId: null,
    };
    saveState({ ...previous, submissionReassessment: state });
  };

  const showValidationStarted = (ctx: ExtensionContext): void => {
    const pullRequestUrl =
      watcherDisplay.kind === "implementing" ||
      watcherDisplay.kind === "validating" ||
      watcherDisplay.kind === "waiting-for-human-review"
        ? watcherDisplay.pullRequestUrl
        : null;
    showWatcher(ctx, { kind: "validating", pullRequestUrl });
  };

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const runningReassessment = persisted?.submissionReassessment;
    if (runningReassessment?.state === "running" && runningReassessment.baseRef !== null) {
      const evidence = commandReassessmentEvidence(
        event.input.command,
        changeId ?? "",
        runningReassessment.baseRef,
      );
      if (Object.values(evidence).some(Boolean)) {
        pendingReassessmentEvidence.set(event.toolCallId, evidence);
      }
    }
    if (!containsVisibleChangeSubmit(event.input.command)) return;
    const reassessment = persisted?.submissionReassessment;
    if (reassessment?.state === "complete" || reassessment?.state === "not-required") {
      showValidationStarted(ctx);
      return;
    }
    if (
      reassessment?.state === "awaiting-settle" ||
      reassessment?.state === "awaiting-restart" ||
      reassessment?.state === "running"
    ) {
      return { block: true, reason: pendingReassessmentMessage };
    }
    if (changeId === undefined) {
      return {
        block: true,
        reason: inspectionFailureMessage("this Implementer session has no bound Change identity"),
      };
    }

    const eligibility = await inspectReassessmentEligibility(ctx, changeId);
    if (!eligibility.ok) {
      return { block: true, reason: inspectionFailureMessage(eligibility.message) };
    }
    if (!eligibility.hasAcceptanceContext) {
      saveSubmissionReassessment({
        state: "not-required",
        baseRef: null,
        evidence: emptyReassessmentEvidence(),
      });
      showValidationStarted(ctx);
      return;
    }
    saveSubmissionReassessment({
      state: "awaiting-settle",
      baseRef: eligibility.baseRef,
      evidence: emptyReassessmentEvidence(),
    });
    return { block: true, reason: interruptedSubmissionMessage };
  });

  pi.on("tool_result", (event) => {
    if (!isBashToolResult(event)) return;
    const observed = pendingReassessmentEvidence.get(event.toolCallId);
    pendingReassessmentEvidence.delete(event.toolCallId);
    if (observed === undefined || event.isError) return;
    const reassessment = persisted?.submissionReassessment;
    if (reassessment?.state !== "running") return;
    saveSubmissionReassessment({
      ...reassessment,
      evidence: {
        change: reassessment.evidence.change || observed.change,
        acceptanceContext: reassessment.evidence.acceptanceContext || observed.acceptanceContext,
        worktreeStatus: reassessment.evidence.worktreeStatus || observed.worktreeStatus,
        candidateDiff: reassessment.evidence.candidateDiff || observed.candidateDiff,
      },
    });
  });

  const latestResolution = (history: BlockerHistory): BlockerResolution | null => {
    const latest = history.resolutions.at(-1);
    return latest !== undefined && isResolution(latest) ? latest : null;
  };

  const resolutionId = (resolution: BlockerResolution | null): string | null =>
    resolution?.id ?? null;

  const resolutionMessage = (
    id: string,
    resolution: BlockerResolution,
    hasFindings: boolean,
    commandPrefix: ButWhyCommandPrefix,
  ): string => {
    const explanation = resolution.content;
    const next = hasFindings
      ? `Now inspect the earlier Findings with \`${butWhyCommand(commandPrefix, "change", "findings", id)}\`, fix every applicable problem in the Managed Worktree, commit the fixes, and submit again with \`${butWhyCommand(commandPrefix, "change", "submit", id)}\`.`
      : `Now inspect \`${butWhyCommand(commandPrefix, "change", "show", id)}\`, including its complete Acceptance Context when present, and the Managed Worktree. Continue implementing the complete accepted intent until Change Submit passes.`;
    return `An Implementation Blocker Resolution was recorded for Change ${id}: ${explanation} ${next}`;
  };

  const validationFailureMessage = (
    id: string,
    snapshot: ChangeInspectionSnapshot,
    commandPrefix: ButWhyCommandPrefix,
  ): string => {
    const runId = snapshot.currentValidationRun?.id;
    const detail =
      runId !== undefined
        ? `Inspect the Validation Tooling Failure with \`${butWhyCommand(commandPrefix, "validation-run", "show", runId)}\`.`
        : `Inspect the Validation Tooling Failure with \`${butWhyCommand(commandPrefix, "change", "show", id)}\`.`;
    return `The Change ${id} has a Validation Tooling Failure. ${detail} Recover the validation tooling, then submit the Change again with \`${butWhyCommand(commandPrefix, "change", "submit", id)}\`.`;
  };

  const clearBlockedPolling = (): void => {
    if (pollingTimer !== undefined) clearTimeout(pollingTimer);
    pollingTimer = undefined;
  };

  let continueWatching: (ctx: ExtensionContext, explicit: boolean) => Promise<void>;

  const scheduleBlockedPolling = (ctx: ExtensionContext): void => {
    clearBlockedPolling();
    if (shutDown || persisted?.paused) return;
    pollingTimer = setTimeout(() => {
      pollingTimer = undefined;
      void continueWatching(ctx, false);
    }, blockerPollingIntervalMs);
    if (typeof pollingTimer === "object") pollingTimer.unref();
  };

  const initialize = async (ctx: ExtensionContext): Promise<void> => {
    if (changeId === undefined) {
      ctx.ui.setWidget(watcherWidget, undefined);
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
    const latest = latestResolution(observed.blockerHistory);
    const latestId = resolutionId(latest);
    const previous = persisted;
    const handledResolutionId = previous?.resolutionId ?? null;
    const resolutionChanged = latestId !== null && latestId !== handledResolutionId;
    const pendingResolutionId = resolutionChanged
      ? latestId
      : (previous?.pendingResolutionId ?? null);
    const initializedState: PersistedContinuationState = {
      changeId,
      fingerprint: observed.fingerprint,
      unchangedRestarts: 0,
      paused: false,
      resolutionId: handledResolutionId,
      pendingResolutionId,
      ...(previous?.submissionReassessment === undefined
        ? {}
        : { submissionReassessment: previous.submissionReassessment }),
    };
    saveState(initializedState);
    showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
    if (observed.blockerHistory.active !== null && observed.snapshot.change.state === "open") {
      scheduleBlockedPolling(ctx);
      return;
    }
    clearBlockedPolling();
    if (
      pendingResolutionId !== null &&
      latest !== null &&
      latest.id === pendingResolutionId &&
      observed.snapshot.change.state === "open" &&
      ctx.isIdle()
    ) {
      saveState({
        ...initializedState,
        resolutionId: latest.id,
        pendingResolutionId: null,
      });
      showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
      pi.sendUserMessage(
        resolutionMessage(
          changeId,
          latest,
          observed.snapshot.findingCount > 0,
          commandPrefixFor(ctx.cwd),
        ),
      );
    }
  };

  const pause = (ctx: ExtensionContext): void => {
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
      resolutionId: null,
    };
    saveState({ ...state, paused: true });
    showWatcher(ctx, { kind: "paused" });
    ctx.ui.notify(
      "But Why Change continuation is paused. Discuss the Change, then run /continue-change to refresh and continue.",
      "info",
    );
  };

  continueWatching = async (ctx: ExtensionContext, explicit: boolean): Promise<void> => {
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
          resolutionId: null,
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

      const commandPrefix = commandPrefixFor(ctx.cwd);
      const previous = persisted ?? {
        changeId: id,
        fingerprint: observed.fingerprint,
        unchangedRestarts: 0,
        paused: false,
        resolutionId: null,
      };
      const currentResolution = latestResolution(observed.blockerHistory);
      const currentResolutionId = resolutionId(currentResolution);
      const resolutionChanged =
        previous.resolutionId !== undefined &&
        currentResolutionId !== null &&
        currentResolutionId !== previous.resolutionId;
      const pendingResolution =
        currentResolutionId !== null && previous.pendingResolutionId === currentResolutionId;
      const retry = explicit
        ? { fingerprint: observed.fingerprint, unchangedRestarts: 0 }
        : nextRetryState(previous, observed.fingerprint);
      saveState({
        ...previous,
        ...retry,
        paused: false,
        resolutionId: previous.resolutionId ?? currentResolutionId,
        pendingResolutionId: resolutionChanged
          ? currentResolutionId
          : (previous.pendingResolutionId ?? null),
      });

      if (observed.blockerHistory.active !== null && observed.snapshot.change.state === "open") {
        showWatcher(ctx, { kind: "blocked" });
        scheduleBlockedPolling(ctx);
        return;
      }
      clearBlockedPolling();
      if ((resolutionChanged || pendingResolution) && currentResolution !== null) {
        if (observed.snapshot.change.state === "open") {
          saveState({
            ...previous,
            ...retry,
            paused: false,
            resolutionId: currentResolutionId,
            pendingResolutionId: null,
          });
          showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
          pi.sendUserMessage(
            resolutionMessage(
              id,
              currentResolution,
              observed.snapshot.findingCount > 0,
              commandPrefix,
            ),
          );
        } else {
          showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
        }
        return;
      }
      if (explicit && observed.snapshot.toolingFailureCount > 0) {
        showWatcher(ctx, { kind: "stopped" });
        pi.sendUserMessage(validationFailureMessage(id, observed.snapshot, commandPrefix));
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
            `The Change ${id} has a Candidate ready for human review. Resume revision work in the Managed Worktree under the operator's direct instruction. Record new Implementation Decisions when needed, commit the revised Candidate, and run ${butWhyCommand(commandPrefix, "change", "submit", id)} before publication.`,
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
      const message = buildContinuationMessage(decision, id, commandPrefix);
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

  const startSubmissionReassessment = (
    ctx: ExtensionContext,
    reassessment: SubmissionReassessment,
  ): void => {
    if (changeId === undefined || reassessment.baseRef === null) {
      return;
    }
    saveSubmissionReassessment({ ...reassessment, state: "running" });
    pi.sendUserMessage(
      submissionReassessmentMessage(changeId, commandPrefixFor(ctx.cwd), reassessment.baseRef),
    );
  };

  pi.on("session_start", async (_event, ctx) => {
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
        const reassessment = persisted.submissionReassessment;
        if (reassessment?.state === "awaiting-restart" && !ctx.isIdle()) {
          ctx.ui.notify(
            "But Why cannot restart the reassessment while an agent run is active.",
            "warning",
          );
          return;
        }
        pauseGeneration += 1;
        saveState({ ...persisted, paused: false, unchangedRestarts: 0 });
        if (reassessment?.state === "awaiting-restart") {
          startSubmissionReassessment(ctx, reassessment);
          return;
        }
      }
      await continueWatching(ctx, true);
    },
  });

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return;
    const inputChangeId = extractChangeId(event.text);
    if (inputChangeId === undefined || changeId !== undefined) return;
    changeId = inputChangeId;
    showWatcher(
      ctx,
      persisted?.paused ? { kind: "paused" } : { kind: "implementing", pullRequestUrl: null },
    );
  });

  pi.on("session_shutdown", () => {
    shutDown = true;
    pauseGeneration += 1;
    clearBlockedPolling();
    activeInspectionAbortController?.abort();
    activeInspectionAbortController = undefined;
    pendingReassessmentEvidence.clear();
  });

  pi.on("agent_end", (event, ctx) => {
    if (
      event.messages.some(
        (message) => message.role === "assistant" && message.stopReason === "aborted",
      ) &&
      changeId !== undefined
    ) {
      const reassessment = persisted?.submissionReassessment;
      if (reassessment?.state === "awaiting-settle") return;
      if (reassessment?.state === "running") {
        saveSubmissionReassessment({
          ...reassessment,
          state: "awaiting-restart",
          evidence: emptyReassessmentEvidence(),
        });
      }
      pause(ctx);
      return;
    }
    const reassessment = persisted?.submissionReassessment;
    if (
      reassessment?.state === "running" &&
      !reassessmentEvidenceComplete(reassessment) &&
      changeId !== undefined
    ) {
      pi.sendUserMessage(
        incompleteReassessmentMessage(reassessment, changeId, commandPrefixFor(ctx.cwd)),
        { deliverAs: "followUp" },
      );
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (persisted?.paused) {
      await continueWatching(ctx, false);
      return;
    }
    const reassessment = persisted?.submissionReassessment;
    if (reassessment?.state === "awaiting-settle") {
      startSubmissionReassessment(ctx, reassessment);
      return;
    }
    if (reassessment?.state === "running") {
      if (!reassessmentEvidenceComplete(reassessment)) return;
      saveSubmissionReassessment({ ...reassessment, state: "complete" });
    }
    await continueWatching(ctx, false);
  });
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isOptionalNullableString = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";

const isReassessmentEvidence = (value: unknown): value is ReassessmentEvidence =>
  isRecord(value) &&
  typeof recordValue(value, "change") === "boolean" &&
  typeof recordValue(value, "acceptanceContext") === "boolean" &&
  typeof recordValue(value, "worktreeStatus") === "boolean" &&
  typeof recordValue(value, "candidateDiff") === "boolean";

const isSubmissionReassessment = (value: unknown): value is SubmissionReassessment =>
  isRecord(value) &&
  (recordValue(value, "state") === "awaiting-settle" ||
    recordValue(value, "state") === "awaiting-restart" ||
    recordValue(value, "state") === "running" ||
    recordValue(value, "state") === "complete" ||
    recordValue(value, "state") === "not-required") &&
  (recordValue(value, "baseRef") === null || typeof recordValue(value, "baseRef") === "string") &&
  isReassessmentEvidence(recordValue(value, "evidence"));

const isPersistedState = (value: unknown): value is PersistedContinuationState =>
  isRecord(value) &&
  typeof recordValue(value, "changeId") === "string" &&
  typeof recordValue(value, "fingerprint") === "string" &&
  isNonNegativeInteger(recordValue(value, "unchangedRestarts")) &&
  typeof recordValue(value, "paused") === "boolean" &&
  isOptionalNullableString(recordValue(value, "resolutionId")) &&
  isOptionalNullableString(recordValue(value, "pendingResolutionId")) &&
  (recordValue(value, "submissionReassessment") === undefined ||
    isSubmissionReassessment(recordValue(value, "submissionReassessment")));

const isCandidate = (value: unknown): value is CurrentCandidate =>
  isRecord(value) &&
  typeof recordValue(value, "id") === "string" &&
  typeof recordValue(value, "headSha") === "string";

const isValidationRun = (value: unknown): value is CurrentValidationRun =>
  isRecord(value) &&
  typeof recordValue(value, "id") === "string" &&
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
        typeof recordValue(publication, "candidateId") === "string" &&
        typeof recordValue(publication, "expectedHeadSha") === "string" &&
        (recordValue(publication, "pullRequest") === null ||
          isRecord(recordValue(publication, "pullRequest")))))
  );
};

const isResolution = (value: unknown): value is BlockerResolution =>
  isRecord(value) &&
  typeof recordValue(value, "id") === "string" &&
  typeof recordValue(value, "content") === "string";

const isBlockerHistory = (value: unknown): value is BlockerHistory => {
  if (!isRecord(value)) return false;
  const blockers = recordValue(value, "blockers");
  const resolutions = recordValue(value, "resolutions");
  const active = recordValue(value, "active");
  return (
    Array.isArray(blockers) &&
    blockers.every(isRecord) &&
    Array.isArray(resolutions) &&
    resolutions.every(isRecord) &&
    (resolutions.length === 0 || isResolution(resolutions.at(-1))) &&
    (active === null || isRecord(active))
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordValue = (record: Record<string, unknown>, key: string): unknown => record[key];
