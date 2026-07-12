import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAutomaticFixing } from "../src/validationRun/automaticFixing.js";
import {
  resolveValidationPolicySnapshot,
  resolveValidationPolicySnapshotFromSubmitConfig,
} from "../src/validationRun/validationPolicySnapshot.js";
import { resolveCopiedFiles } from "../src/validationRun/copiedFiles.js";
import { validationRunLeaseRenewalIntervalMs } from "../src/validationRun/candidateValidationRun.js";
import { resolveSubmitPolicySnapshot } from "../src/submit/submitRepoConfig.js";
import { openSqliteCandidateValidationRunStore } from "../src/sqlite/sqliteCandidateValidationRunStore.js";
import { openSqliteChangeStore } from "../src/sqlite/sqliteChangeStore.js";
import { openSqliteCandidateStore } from "../src/sqlite/sqliteCandidateStore.js";
import { cleanupTempRoots, createGitRepo, runByInProcessArgs as runBy } from "./support/by-cli.js";

const now = "2026-07-12T10:00:00.000Z";
const policy = (command = "pnpm test") =>
  resolveValidationPolicySnapshot({ checks: [{ id: "tests", command }], reviewers: [] });

afterEach(cleanupTempRoots);

describe("Candidate-owned Validation Runs", () => {
  it("canonicalizes policy snapshots and excludes instruction paths", () => {
    expect(validationRunLeaseRenewalIntervalMs).toBe(15_000);
    expect(
      resolveSubmitPolicySnapshot({
        config: {
          sandboxMode: "none",
          automaticFixing: true,
          checks: [{ id: "tests", command: "pnpm test", timeoutSeconds: 1200 }],
        },
        repositoryRoot: ".",
      }),
    ).toMatchObject({ ok: true });
    expect(
      resolveValidationPolicySnapshotFromSubmitConfig({
        config: {
          sandboxMode: "none",
          automaticFixing: true,
          checks: [{ id: "tests", command: "pnpm test", timeoutSeconds: 1200 }],
        },
        instructionsByPath: {},
      }),
    ).toMatchObject({ ok: true });
    const first = resolveValidationPolicySnapshot({
      checks: [{ id: "tests", command: "pnpm test" }],
      reviewers: [
        {
          role: "specialist",
          id: "security",
          instructions: "Review secrets.\n",
          agent: { agentRuntime: "pi", thinking: "low" },
        },
      ],
    });
    const second = resolveValidationPolicySnapshot({
      reviewers: [
        {
          role: "specialist",
          id: "security",
          instructions: "Review secrets.\n",
          agent: { thinking: "low", agentRuntime: "pi" },
        },
      ],
      checks: [{ command: "pnpm test", id: "tests" }],
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.snapshot.reviewers[0]?.instructions).toBe("Review secrets.\n");
  });

  it("resolves automatic fixing separately and ignores manual overrides for AFK", () => {
    expect(
      resolveAutomaticFixing({ origin: "manual", repoConfigValue: false, enabledOverride: true }),
    ).toEqual({
      enabled: true,
      source: "manual_override",
      command: null,
    });
    expect(
      resolveAutomaticFixing({
        origin: "manual",
        repoConfigValue: true,
        commandOverride: "fix --safe",
      }),
    ).toEqual({
      enabled: true,
      source: "repo_config",
      command: "fix --safe",
    });
    expect(
      resolveAutomaticFixing({ origin: "afk", repoConfigValue: false, enabledOverride: true }),
    ).toEqual({
      enabled: false,
      source: "repo_config",
      command: null,
    });
  });

  it("reuses matching work, supersedes changed inputs, and retries tooling failures", () => {
    const root = initializedRepo();
    const { change, candidate } = createCandidate(root);
    const store = validationStore(root);
    const first = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      now,
    });
    expect(first.ok && first.kind).toBe("new_created");
    if (!first.ok) return;

    expect(
      store.requestValidation({
        changeId: change.id,
        candidateId: candidate.id,
        policySnapshot: policy().snapshot,
        automaticFixing: { enabled: false, command: "fix --safe" },
        now,
      }),
    ).toMatchObject({ ok: true, kind: "active_reused", run: { id: first.run.id } });

    const lease = store.acquireLease({
      validationRunId: first.run.id,
      holderId: "worker-1",
      now,
      nowMs: Date.parse(now),
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    expect(
      store.recordEvidence({
        validationRunId: first.run.id,
        leaseToken: lease.lease.leaseToken,
        phase: "checks",
        evidence: { passed: true },
        outcome: "passed",
        now,
      }),
    ).toEqual({ ok: true, applied: true });

    const complete = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      now,
    });
    expect(complete).toMatchObject({
      ok: true,
      kind: "complete_reused",
      run: { id: first.run.id },
    });

    const changed = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy("pnpm test --changed").snapshot,
      copiedFiles: [{ path: "package.json", contentSha256: "d".repeat(64) }],
      now: "2026-07-12T10:01:00.000Z",
    });
    expect(changed).toMatchObject({ ok: true, kind: "new_created" });
    if (!changed.ok) return;
    expect(store.getValidationRunById(first.run.id)?.state).toBe("complete");
    expect(store.getCurrentValidationState(change.id)).toMatchObject({
      candidateId: candidate.id,
      validationRunId: changed.run.id,
    });
  });

  it("keeps superseded late evidence inspectable without applying it", () => {
    const root = initializedRepo();
    const { change, candidate } = createCandidate(root);
    const store = validationStore(root);
    const created = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lease = store.acquireLease({
      validationRunId: created.run.id,
      holderId: "worker",
      now,
      nowMs: Date.parse(now),
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    const replacement = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy("pnpm test --new").snapshot,
      now: "2026-07-12T10:01:00.000Z",
    });
    expect(replacement).toMatchObject({ ok: true, kind: "new_created" });
    expect(
      store.recordEvidence({
        validationRunId: created.run.id,
        leaseToken: lease.lease.leaseToken,
        phase: "checks",
        evidence: { late: true },
        now: "2026-07-12T10:01:01.000Z",
      }),
    ).toEqual({ ok: true, applied: false });
    expect(store.listEvidence(created.run.id)).toEqual([
      {
        sequence: 1,
        phase: "checks",
        producer: "unknown",
        phaseStatus: null,
        evidence: { late: true },
        accepted: false,
        createdAt: "2026-07-12T10:01:01.000Z",
      },
    ]);
  });

  it("supersedes active validation when a successor Candidate is captured", () => {
    const root = initializedRepo();
    const { change, candidate } = createCandidate(root);
    const store = validationStore(root);
    const created = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const successor = openSqliteCandidateStore(sqliteInput(root)).captureCandidate({
      changeId: change.id,
      selectedBaseRef: "refs/heads/main",
      resolvedTargetSha: "a".repeat(40),
      comparisonBaseSha: "b".repeat(40),
      headSha: "e".repeat(40),
      now: "2026-07-12T10:01:00.000Z",
    });
    expect(successor.ok).toBe(true);
    if (!successor.ok) return;
    expect(store.getValidationRunById(created.run.id)?.state).toBe("superseded");
    expect(store.getCurrentValidationState(change.id)).toMatchObject({
      candidateId: successor.candidate.id,
      validationRunId: null,
    });
    expect(
      store.requestValidation({
        changeId: change.id,
        candidateId: candidate.id,
        policySnapshot: policy().snapshot,
        now: "2026-07-12T10:02:00.000Z",
      }),
    ).toEqual({ ok: false, code: "candidate_not_current" });
  });

  it("persists Findings and reuses blocked evidence without rerunning", () => {
    const root = initializedRepo();
    const { change, candidate } = createCandidate(root);
    const store = validationStore(root);
    const created = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lease = store.acquireLease({
      validationRunId: created.run.id,
      holderId: "worker",
      now,
      nowMs: Date.parse(now),
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    expect(
      store.recordFinding({
        id: `${created.run.id}-F1`,
        validationRunId: created.run.id,
        leaseToken: lease.lease.leaseToken,
        phase: "checks",
        producer: "tests",
        title: "Check failed",
        description: "The configured check failed.",
        evidence: "exit code 1",
        now,
      }),
    ).toEqual({ ok: true, applied: true });
    expect(store.listFindings(created.run.id)).toMatchObject([
      { id: `${created.run.id}-F1`, accepted: true },
    ]);
    expect(
      store.requestValidation({
        changeId: change.id,
        candidateId: candidate.id,
        policySnapshot: policy().snapshot,
        automaticFixing: { enabled: true, command: "fix" },
        now: "2026-07-12T10:01:00.000Z",
      }),
    ).toMatchObject({
      ok: true,
      kind: "complete_reused",
      run: { id: created.run.id, outcome: "blocked" },
    });
  });

  it("hashes configured copied files without storing their contents", () => {
    const root = initializedRepo();
    const copied = resolveCopiedFiles(root, [".but-why/config.json"]);
    expect(copied).toMatchObject({ ok: true, files: [{ path: ".but-why/config.json" }] });
  });

  it("rejects empty Acceptance Context and expires leases", () => {
    const root = initializedRepo();
    const { change, candidate } = createCandidate(root);
    const store = validationStore(root);
    const empty = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      acceptanceContext: { version: 1, title: " ", description: "", comments: ["\n"] },
      now,
    });
    expect(empty).toEqual({ ok: false, code: "empty_acceptance_context" });

    const created = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(
      store.acquireLease({ validationRunId: created.run.id, holderId: "worker", now, nowMs: 0 }),
    ).toMatchObject({ ok: true });
    expect(
      store.acquireLease({
        validationRunId: created.run.id,
        holderId: "other",
        now: "2026-07-12T10:01:01.000Z",
        nowMs: Date.parse(now) + 61_000,
      }),
    ).toEqual({ ok: false, code: "lease_expired_run", retryable: true });
    expect(store.getValidationRunById(created.run.id)?.outcome).toBe("tooling_failed");
    const retry = store.requestValidation({
      changeId: change.id,
      candidateId: candidate.id,
      policySnapshot: policy().snapshot,
      now: "2026-07-12T10:02:00.000Z",
    });
    expect(retry).toMatchObject({ ok: true, kind: "retry_created" });
  });
});

const initializedRepo = (): string => {
  const root = createGitRepo();
  expect(runBy(root, "init", "--task-prefix", "BY").status).toBe(0);
  return root;
};

const sqliteInput = (root: string) => ({
  statePath: join(root, ".but-why/state.sqlite"),
  migrationTimestamp: () => now,
});

const createCandidate = (root: string) => {
  const changes = openSqliteChangeStore(sqliteInput(root));
  const candidates = openSqliteCandidateStore(sqliteInput(root));
  const created = changes.createChange({
    repositoryCommonDirectory: "/repos/example/.git",
    branchRef: "refs/heads/feature",
    now,
  });
  if (!created.ok) throw new Error("Could not create Change");
  const captured = candidates.captureCandidate({
    changeId: created.change.id,
    selectedBaseRef: "refs/heads/main",
    resolvedTargetSha: "a".repeat(40),
    comparisonBaseSha: "b".repeat(40),
    headSha: "c".repeat(40),
    now,
  });
  if (!captured.ok) throw new Error("Could not create Candidate");
  return { change: created.change, candidate: captured.candidate };
};

const validationStore = (root: string) => openSqliteCandidateValidationRunStore(sqliteInput(root));
