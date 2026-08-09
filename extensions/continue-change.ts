import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
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
};

type BlockerResolution = JsonObject & {
  readonly id: string;
  readonly content: string;
};

export type ChangeInspectionSnapshot = {
  readonly change: {
    readonly state: ChangeState;
    readonly closeReason: ChangeCloseReason | null;
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

type PersistedContinuationState = RetryState & {
  readonly changeId: string;
  readonly paused: boolean;
  readonly resolutionId?: string | null;
  readonly pendingResolutionId?: string | null;
};

type WatcherDisplay =
  | { readonly kind: "watching" }
  | { readonly kind: "checking" }
  | { readonly kind: "paused" }
  | { readonly kind: "complete" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "cleanup-needed" }
  | { readonly kind: "idle" }
  | { readonly kind: "blocked" }
  | { readonly kind: "inspection-failed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "waiting-for-human-merge" };

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
const changeIdPattern =
  /^\s*Change identity:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.?\s*$/imu;
type ButWhyCommandPrefix = "just by" | "npx -y but-why";

const defaultCommandPrefix: ButWhyCommandPrefix = "npx -y but-why";
const butWhyCommand = (prefix: ButWhyCommandPrefix, ...args: readonly string[]): string =>
  [prefix, ...args].join(" ");

export const extractChangeId = (text: string): string | undefined =>
  text.match(changeIdPattern)?.[1];

const submitCommandPattern =
  /(?:^|[\n;|&(){}])\s*(?:(?:if|then|elif|else|while|until|do|!)\s+)*(?:just\s+by|pnpx\s+but-why|npx\s+-y\s+but-why)\s+change\s+submit(?:\s|$)/gu;

const visibleShellText = (command: string): string => {
  let result = "";
  let quote: "'" | '"' | undefined;
  let comment = false;
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
    if (quote !== undefined) {
      if (quote === '"' && character === "\\") {
        result += " ".repeat(Math.min(2, command.length - index));
        index += 1;
      } else {
        if (character === quote) quote = undefined;
        result += " ";
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      result += " ";
    } else if (character === "\\") {
      result += " ".repeat(Math.min(2, command.length - index));
      index += 1;
    } else if (character === "#" && (index === 0 || /[\s;|&(){}]/u.test(command[index - 1] ?? ""))) {
      comment = true;
      result += " ";
    } else {
      result += character;
    }
  }
  return result;
};

export const countVisibleChangeSubmits = (command: string): number =>
  [...visibleShellText(command).matchAll(submitCommandPattern)].length;

export const containsVisibleChangeSubmit = (command: string): boolean =>
  countVisibleChangeSubmits(command) > 0;

const submissionReassessmentMessage = [
  "But Why blocked the complete Bash tool call before any part of it executed.",
  "Reassess the Candidate against the complete accepted intent.",
  "Retry all required commands before Change Submission, including the blocked Change Submit command.",
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
  if (
    snapshot.change.state === "closed" ||
    snapshot.toolingFailureCount > 0
  ) {
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
    `Inspect \`${butWhyCommand(commandPrefix, "change", "show", changeId)}\`, the Managed Worktree, and the linked Task Context when present.`,
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
  let watcherDisplay: WatcherDisplay = { kind: "watching" };
  let submitAllowed = false;

  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const submitCount = countVisibleChangeSubmits(event.input.command);
    if (submitCount === 0) return;
    if (submitAllowed && submitCount === 1) {
      submitAllowed = false;
      return;
    }
    submitAllowed = true;
    pi.sendUserMessage(submissionReassessmentMessage, { deliverAs: "steer" });
    return { block: true, reason: submissionReassessmentMessage };
  });

  const showWatcher = (ctx: ExtensionContext, display: WatcherDisplay): void => {
    watcherDisplay = display;
    if (changeId === undefined) {
      ctx.ui.setWidget(watcherWidget, undefined);
      return;
    }
    const text = (() => {
      switch (display.kind) {
        case "watching":
          return `● Watching Change ${changeId.slice(0, 8)}…`;
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
        case "waiting-for-human-merge":
          return "◌ Waiting for human merge";
      }
    })();
    ctx.ui.setWidget(
      watcherWidget,
      (_tui, theme) => ({
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
                      display.kind === "waiting-for-human-merge"
                    ? "success"
                    : display.kind === "checking"
                      ? "muted"
                      : "accent",
              text.slice(0, Math.max(width, 0)),
            ),
          ];
        },
        invalidate() {},
      }),
    );
  };

  const displayFor = (
    snapshot: ChangeInspectionSnapshot,
    git: GitInspection,
    blockerHistory: BlockerHistory,
  ): WatcherDisplay => {
    if (blockerHistory.active !== null) {
      return { kind: "blocked" };
    }
    if (snapshot.change.state === "closed") {
      if (snapshot.cleanup?.state === "pending") return { kind: "cleanup-needed" };
      return snapshot.change.closeReason === "cancelled"
        ? { kind: "cancelled" }
        : { kind: "complete" };
    }
    if (snapshot.toolingFailureCount > 0) return { kind: "stopped" };
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
        return { kind: "waiting-for-human-merge" };
      }
      return { kind: "idle" };
    }
    return { kind: "watching" };
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
  ): Promise<RunResult> => {
    const label = [command, ...args].join(" ");
    try {
      const result = await pi.exec(command, [...args], { cwd, timeout: 15_000 });
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
  ): Promise<RunResult> => {
    const prefix = commandPrefixFor(cwd);
    const [command, ...args] = cliInvocation(prefix, commandArgs);
    return run(command, args, cwd);
  };

  const inspect = async (ctx: ExtensionContext, id: string): Promise<InspectionResult> => {
    const args = ["--json", "change", "show", id];
    const blockerArgs = ["--json", "change", "blocker", "list", id];
    const [changeResult, blockerResult, headResult, statusResult, unstagedResult, stagedResult, untrackedResult] =
      await Promise.all([
        inspectCommand(args, ctx.cwd),
        inspectCommand(blockerArgs, ctx.cwd),
        run("git", ["rev-parse", "HEAD"], ctx.cwd),
        run("git", ["status", "--porcelain=v1", "--untracked-files=all"], ctx.cwd),
        run("git", ["diff", "--no-ext-diff", "--binary"], ctx.cwd),
        run("git", ["diff", "--cached", "--no-ext-diff", "--binary"], ctx.cwd),
        run("git", ["ls-files", "--others", "--exclude-standard", "-z"], ctx.cwd),
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
        : await run("git", ["hash-object", "--", ...untrackedPaths], ctx.cwd);
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
      snapshotValue = JSON.parse(changeResult.stdout);
      blockerValue = JSON.parse(blockerResult.stdout);
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
      : `Now inspect \`${butWhyCommand(commandPrefix, "change", "show", id)}\`, the Managed Worktree, and the linked Task Context when present. Continue implementing the complete accepted intent until Change Submit passes.`;
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
    if (!observed.ok) {
      showWatcher(ctx, { kind: "inspection-failed" });
      return;
    }
    const latest = resolutionId(latestResolution(observed.blockerHistory));
    const previousResolutionId = persisted?.resolutionId;
    const resolutionChanged =
      previousResolutionId !== undefined &&
      latest !== null &&
      latest !== previousResolutionId;
    const pendingResolutionId = persisted?.pendingResolutionId;
    const pendingResolution =
      resolutionChanged ||
      (pendingResolutionId !== undefined &&
        pendingResolutionId !== null &&
        pendingResolutionId !== latest)
        ? latest
        : (pendingResolutionId ?? null);
    saveState({
      changeId,
      fingerprint: observed.fingerprint,
      unchangedRestarts: 0,
      paused: false,
      resolutionId: latest,
      pendingResolutionId: pendingResolution,
    });
    showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
  };

  const pause = (ctx: ExtensionContext): void => {
    if (changeId === undefined) {
      ctx.ui.notify("But Why automatic continuation is unavailable because this session has no Change.", "warning");
      return;
    }
    pauseGeneration += 1;
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

  const continueWatching = async (ctx: ExtensionContext, explicit: boolean): Promise<void> => {
    if (!ctx.isIdle() || settling) return;
    if (changeId === undefined) {
      showWatcher(ctx, { kind: "watching" });
      return;
    }
    if (!explicit && persisted?.paused) {
      showWatcher(ctx, { kind: "paused" });
      return;
    }
    const id = changeId;
    const startedAtPauseGeneration = pauseGeneration;
    settling = true;
    showWatcher(ctx, { kind: "checking" });
    try {
      const observed = await inspect(ctx, id);
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
        if (retry.unchangedRestarts > maxUnchangedRestarts) {
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
        if (!explicit && ctx.isIdle()) {
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
        resolutionId: currentResolutionId,
        pendingResolutionId: resolutionChanged
          ? currentResolutionId
          : previous.pendingResolutionId ?? null,
      });

      if (observed.blockerHistory.active !== null) {
        showWatcher(ctx, { kind: "blocked" });
        return;
      }
      if (!explicit && (resolutionChanged || pendingResolution)) {
        showWatcher(ctx, displayFor(observed.snapshot, observed.git, observed.blockerHistory));
        return;
      }
      if (explicit && (resolutionChanged || pendingResolution) && currentResolution !== null) {
        showWatcher(ctx, { kind: "watching" });
        if (observed.snapshot.change.state === "open") {
          saveState({
            ...previous,
            ...retry,
            resolutionId: currentResolutionId,
            pendingResolutionId: null,
          });
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
          showWatcher(ctx, { kind: "watching" });
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
      showWatcher(ctx, { kind: "watching" });
      if (ctx.isIdle()) pi.sendUserMessage(message);
    } finally {
      settling = false;
      if (watcherDisplay.kind === "checking") showWatcher(ctx, { kind: "watching" });
    }
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
    description: "Refresh and continue the Change watcher",
    handler: async (_args, ctx) => {
      if (changeId === undefined) {
        ctx.ui.notify("But Why automatic continuation is unavailable because this session has no Change.", "warning");
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

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return;
    const inputChangeId = extractChangeId(event.text);
    if (inputChangeId === undefined || changeId !== undefined) return;
    changeId = inputChangeId;
    showWatcher(ctx, persisted?.paused ? { kind: "paused" } : { kind: "watching" });
  });

  pi.on("agent_end", (event, ctx) => {
    if (
      event.messages.some(
        (message) => message.role === "assistant" && message.stopReason === "aborted",
      ) &&
      changeId !== undefined
    ) {
      pause(ctx);
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await continueWatching(ctx, false);
  });
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isOptionalNullableString = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";

const isPersistedState = (value: unknown): value is PersistedContinuationState =>
  isRecord(value) &&
  typeof recordValue(value, "changeId") === "string" &&
  typeof recordValue(value, "fingerprint") === "string" &&
  isNonNegativeInteger(recordValue(value, "unchangedRestarts")) &&
  typeof recordValue(value, "paused") === "boolean" &&
  isOptionalNullableString(recordValue(value, "resolutionId")) &&
  isOptionalNullableString(recordValue(value, "pendingResolutionId"));

const isCandidate = (value: unknown): value is CurrentCandidate =>
  isRecord(value) &&
  typeof recordValue(value, "id") === "string" &&
  typeof recordValue(value, "headSha") === "string";

const isValidationRun = (value: unknown): value is CurrentValidationRun =>
  isRecord(value) && typeof recordValue(value, "id") === "string";

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
    (candidate === null || isCandidate(candidate)) &&
    (validationRun === null || isValidationRun(validationRun)) &&
    isNonNegativeInteger(recordValue(value, "findingCount")) &&
    isNonNegativeInteger(recordValue(value, "toolingFailureCount")) &&
    (recordValue(value, "pullRequest") === null || isRecord(recordValue(value, "pullRequest"))) &&
    (cleanup === undefined ||
      (isRecord(cleanup) &&
        (recordValue(cleanup, "state") === "complete" || recordValue(cleanup, "state") === "pending"))) &&
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
