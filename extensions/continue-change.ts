import { createHash } from "node:crypto";

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

type ChangeState = "open" | "blocked" | "closed";

export type ChangeInspectionSnapshot = {
  readonly change: {
    readonly state: ChangeState;
    readonly closeReason: string | null;
  };
  readonly currentCandidate: Readonly<Record<string, unknown>> | null;
  readonly currentValidationRun: Readonly<Record<string, unknown>> | null;
  readonly findingCount: number;
  readonly toolingFailureCount: number;
  readonly pullRequest: Readonly<Record<string, unknown>> | null;
  readonly publication?: {
    readonly candidateId: string;
    readonly expectedHeadSha: string;
    readonly pullRequest: Readonly<Record<string, unknown>> | null;
  } | null;
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
};

type WatcherDisplay =
  | { readonly kind: "watching" }
  | { readonly kind: "checking" }
  | { readonly kind: "paused" }
  | { readonly kind: "complete" }
  | { readonly kind: "idle" }
  | { readonly kind: "blocked" }
  | { readonly kind: "recovery" }
  | { readonly kind: "stopped" };

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
      readonly fingerprint: string;
      readonly git: GitInspection;
    }
  | { readonly ok: false; readonly transient: boolean; readonly message: string };

const stateEntry = "but-why-change-continuation";
const watcherWidget = "but-why-change-watcher";
const maxUnchangedRestarts = 3;
const changeIdPattern =
  /^\s*Change identity:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.?\s*$/imu;

export const extractChangeId = (text: string): string | undefined =>
  text.match(changeIdPattern)?.[1];

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
    const changeId = extractChangeId(text);
    if (changeId !== undefined) return changeId;
  }
  return undefined;
};

export const decideContinuation = (
  snapshot: ChangeInspectionSnapshot,
  git?: { readonly head: string; readonly status: string },
): ContinuationDecision => {
  if (
    snapshot.change.state === "closed" ||
    snapshot.change.state === "blocked" ||
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
    recordValue(currentCandidate, "id") === publication.candidateId &&
    recordValue(currentCandidate, "headSha") === publication.expectedHeadSha &&
    git.head === publication.expectedHeadSha &&
    git.status.trim() === "";
  if (hasOwnedPullRequest) return { kind: "idle" };
  return { kind: "general" };
};

export const buildContinuationMessage = (
  decision: ContinuationDecision,
  changeId: string,
  compactionReason: "threshold" | undefined = undefined,
): string => {
  if (decision.kind === "idle") return "";
  if (decision.kind === "findings") {
    return [
      `The Change ${changeId} has Findings.`,
      `Inspect the Findings with \`by change findings ${changeId}\`, fix every applicable problem in the Managed Worktree, commit the fixes, and submit again with \`by change submit ${changeId}\`.`,
    ].join(" ");
  }
  if (compactionReason === "threshold") {
    return [
      "Automatic threshold compaction completed.",
      `Restore the current Change state from the compacted context for ${changeId}, inspect the Managed Worktree, and take the next concrete implementation action.`,
      "The Change is still unfinished. Continue until it has a passing Candidate and an owned pull request, or a durable stopping condition permits idle state.",
    ].join(" ");
  }
  return [
    `The Change ${changeId} is still unfinished.`,
    `Inspect \`by change show ${changeId}\` and the Managed Worktree, then take the next concrete implementation action.`,
  ].join(" ");
};

export const nextRetryState = (previous: RetryState, fingerprint: string): RetryState =>
  fingerprint === previous.fingerprint
    ? { fingerprint, unchangedRestarts: previous.unchangedRestarts + 1 }
    : { fingerprint, unchangedRestarts: 0 };

const durableChangeFingerprint = (snapshot: ChangeInspectionSnapshot, git: GitInspection): string =>
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
      }),
    )
    .digest("hex");

export default function continueChange(pi: ExtensionAPI): void {
  let changeId: string | undefined;
  let persisted: PersistedContinuationState | undefined;
  let pendingThresholdCompaction = false;
  let settling = false;
  let watcherDisplay: WatcherDisplay = { kind: "watching" };

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
        case "idle":
          return "✓ No action needed";
        case "blocked":
          return "! Change is blocked";
        case "recovery":
          return "! Paused - inspection needs recovery";
        case "stopped":
          return "! Watching stopped - no progress";
      }
    })();
    ctx.ui.setWidget(
      watcherWidget,
      (_tui, theme) => ({
        render(width) {
          return [
            theme.fg(
              display.kind === "paused" || display.kind === "recovery"
                ? "warning"
                : display.kind === "blocked" || display.kind === "stopped"
                  ? "error"
                  : display.kind === "complete" || display.kind === "idle"
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

  const idleWatcherDisplay = (snapshot: ChangeInspectionSnapshot): WatcherDisplay => {
    if (snapshot.change.state === "closed") return { kind: "complete" };
    if (snapshot.change.state === "blocked") return { kind: "blocked" };
    return { kind: "idle" };
  };

  const restoreState = (ctx: ExtensionContext): void => {
    const entries = ctx.sessionManager.getBranch();
    const latest = entries
      .filter(
        (entry): entry is Extract<SessionEntry, { type: "custom" }> =>
          entry.type === "custom" && entry.customType === stateEntry,
      )
      .at(-1);
    const data = latest?.data;
    if (!isPersistedState(data)) return;
    persisted = data;
    changeId ??= data.changeId;
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

  const inspectChange = async (id: string, cwd: string): Promise<RunResult> => {
    const args = ["--output", "json", "change", "show", id];
    const installed = await run("by", args, cwd);
    if (
      installed.ok ||
      (installed.transient && !installed.message.startsWith("by could not run:")) ||
      installed.stdout.trim() !== ""
    ) {
      return installed;
    }
    const local = await run("just", ["by", ...args], cwd);
    return local.ok || local.stdout.trim() !== "" ? local : installed;
  };

  const inspect = async (ctx: ExtensionContext, id: string): Promise<InspectionResult> => {
    const [changeResult, headResult, statusResult, unstagedResult, stagedResult, untrackedResult] =
      await Promise.all([
        inspectChange(id, ctx.cwd),
        run("git", ["rev-parse", "HEAD"], ctx.cwd),
        run("git", ["status", "--porcelain=v1", "--untracked-files=all"], ctx.cwd),
        run("git", ["diff", "--no-ext-diff", "--binary"], ctx.cwd),
        run("git", ["diff", "--cached", "--no-ext-diff", "--binary"], ctx.cwd),
        run("git", ["ls-files", "--others", "--exclude-standard", "-z"], ctx.cwd),
      ]);
    if (
      !changeResult.ok ||
      !headResult.ok ||
      !statusResult.ok ||
      !unstagedResult.ok ||
      !stagedResult.ok ||
      !untrackedResult.ok
    ) {
      const failures = [
        changeResult,
        headResult,
        statusResult,
        unstagedResult,
        stagedResult,
        untrackedResult,
      ].filter(
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

    let value: unknown;
    try {
      value = JSON.parse(changeResult.stdout);
    } catch {
      return {
        ok: false,
        transient: false,
        message: "by change show returned malformed JSON",
      };
    }
    if (!isSnapshot(value)) {
      return {
        ok: false,
        transient: false,
        message: "by change show returned an unsupported Change state shape",
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
      snapshot: value,
      fingerprint: durableChangeFingerprint(value, git),
      git,
    };
  };

  const initialize = async (ctx: ExtensionContext): Promise<void> => {
    if (changeId === undefined) {
      showWatcher(ctx, { kind: "watching" });
      return;
    }
    if (persisted?.paused) {
      showWatcher(ctx, { kind: "paused" });
      return;
    }
    showWatcher(ctx, { kind: "checking" });
    try {
      const observed = await inspect(ctx, changeId);
      if (!observed.ok) return;
      if (persisted === undefined || persisted.changeId !== changeId) {
        saveState({
          changeId,
          fingerprint: observed.fingerprint,
          unchangedRestarts: 0,
          paused: false,
        });
        return;
      }
      if (persisted.fingerprint !== observed.fingerprint) {
        saveState({ ...persisted, fingerprint: observed.fingerprint, unchangedRestarts: 0 });
      }
    } finally {
      if (watcherDisplay.kind === "checking") showWatcher(ctx, { kind: "watching" });
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    restoreState(ctx);
    changeId ??= findChangeId(ctx.sessionManager.getBranch());
    await initialize(ctx);
  });

  pi.registerCommand("continue-change", {
    description: "Pause or resume the Change watcher",
    handler: async (_args, ctx) => {
      if (changeId === undefined) {
        ctx.ui.notify("But Why automatic continuation is unavailable because this session has no Change.", "warning");
        return;
      }
      const state = persisted ?? {
        changeId,
        fingerprint: "inspection-unavailable",
        unchangedRestarts: 0,
        paused: false,
      };
      if (!state.paused) {
        saveState({ ...state, paused: true });
        showWatcher(ctx, { kind: "paused" });
        ctx.ui.notify(
          "But Why Change watcher is paused. Discuss the Change, then run /continue-change to resume.",
          "info",
        );
        return;
      }
      saveState({ ...state, paused: false, unchangedRestarts: 0 });
      ctx.ui.notify("But Why Change watcher is resumed.", "info");
      await continueWatching(ctx);
    },
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "extension") {
      const inputChangeId = extractChangeId(event.text);
      if (inputChangeId === undefined) return;
      changeId = inputChangeId;
      showWatcher(ctx, persisted?.paused ? { kind: "paused" } : { kind: "watching" });
    }
  });

  pi.on("session_compact", (event) => {
    pendingThresholdCompaction = event.reason === "threshold";
  });

  pi.on("agent_end", (event, ctx) => {
    if (
      event.messages.some(
        (message) => message.role === "assistant" && message.stopReason === "aborted",
      ) &&
      changeId !== undefined
    ) {
      const state = persisted ?? {
        changeId,
        fingerprint: "inspection-unavailable",
        unchangedRestarts: 0,
        paused: false,
      };
      saveState({ ...state, paused: true });
      showWatcher(ctx, { kind: "paused" });
    }
  });

  const continueWatching = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.isIdle() || settling) return;
    if (changeId === undefined) {
      showWatcher(ctx, { kind: "watching" });
      return;
    }
    if (persisted?.paused) {
      showWatcher(ctx, { kind: "paused" });
      return;
    }
    settling = true;
    showWatcher(ctx, { kind: "checking" });
    try {
      const id = changeId;
      const observed = await inspect(ctx, id);
      if (!observed.ok) {
        const previous = persisted ?? {
          changeId: id,
          fingerprint: "inspection-unavailable",
          unchangedRestarts: 0,
          paused: false,
        };
        if (!observed.transient) {
          pendingThresholdCompaction = false;
          saveState({ ...previous, paused: true });
          showWatcher(ctx, { kind: "recovery" });
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
        pendingThresholdCompaction = false;
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
        showWatcher(ctx, { kind: "watching" });
        ctx.ui.notify(
          "But Why could not inspect the current Change state; automatic continuation will keep trying until inspection recovers or the operator cancels it.",
          "warning",
        );
        if (ctx.isIdle()) {
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
      };
      const retry = nextRetryState(previous, observed.fingerprint);
      const decision = decideContinuation(observed.snapshot, observed.git);
      if (decision.kind === "idle") {
        pendingThresholdCompaction = false;
        saveState({ ...previous, ...retry, paused: false });
        showWatcher(ctx, idleWatcherDisplay(observed.snapshot));
        return;
      }
      if (retry.unchangedRestarts > maxUnchangedRestarts) {
        pendingThresholdCompaction = false;
        saveState({ ...previous, ...retry, paused: false });
        showWatcher(ctx, { kind: "stopped" });
        ctx.ui.notify(
          "But Why automatic continuation stopped after three restarts without Git or Change progress. Take the next action manually.",
          "warning",
        );
        return;
      }
      saveState({ ...previous, ...retry, paused: false });
      const message = buildContinuationMessage(
        decision,
        id,
        pendingThresholdCompaction ? "threshold" : undefined,
      );
      pendingThresholdCompaction = false;
      showWatcher(ctx, { kind: "watching" });
      if (ctx.isIdle()) pi.sendUserMessage(message);
    } finally {
      settling = false;
      if (watcherDisplay.kind === "checking") showWatcher(ctx, { kind: "watching" });
    }
  };

  pi.on("agent_settled", async (_event, ctx) => {
    await continueWatching(ctx);
  });
}

const isPersistedState = (value: unknown): value is PersistedContinuationState =>
  isRecord(value) &&
  typeof recordValue(value, "changeId") === "string" &&
  typeof recordValue(value, "fingerprint") === "string" &&
  typeof recordValue(value, "unchangedRestarts") === "number" &&
  typeof recordValue(value, "paused") === "boolean";

const isSnapshot = (value: unknown): value is ChangeInspectionSnapshot => {
  if (!isRecord(value)) return false;
  const change = recordValue(value, "change");
  const publication = recordValue(value, "publication");
  const validPublication =
    publication === undefined ||
    publication === null ||
    (isRecord(publication) &&
      typeof recordValue(publication, "candidateId") === "string" &&
      typeof recordValue(publication, "expectedHeadSha") === "string" &&
      (recordValue(publication, "pullRequest") === null ||
        isRecord(recordValue(publication, "pullRequest"))));
  return (
    isRecord(change) &&
    (recordValue(change, "state") === "open" ||
      recordValue(change, "state") === "blocked" ||
      recordValue(change, "state") === "closed") &&
    (typeof recordValue(change, "closeReason") === "string" ||
      recordValue(change, "closeReason") === null) &&
    (recordValue(value, "currentCandidate") === null ||
      isRecord(recordValue(value, "currentCandidate"))) &&
    (recordValue(value, "currentValidationRun") === null ||
      isRecord(recordValue(value, "currentValidationRun"))) &&
    typeof recordValue(value, "findingCount") === "number" &&
    typeof recordValue(value, "toolingFailureCount") === "number" &&
    (recordValue(value, "pullRequest") === null || isRecord(recordValue(value, "pullRequest"))) &&
    validPublication
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const recordValue = (record: Record<string, unknown>, key: string): unknown => record[key];
