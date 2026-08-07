import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import type { ChangeRecord } from "../../src/change/change.js";
import { openTerminalCleanup } from "../../src/change/cleanupTerminalChange.js";
import {
  discoverReviewerTranscripts,
  openReviewerTranscriptIndex,
  type ReviewerTranscript,
} from "../../src/change/reviewerSession/reviewerTranscript.js";
import { RepositorySql } from "../../src/sqlite/repositorySql.js";
import { openSqliteChangePersistence } from "../../src/sqlite/sqliteChangePersistence.js";
import { withTemporaryRepositoryState as withTemporaryState } from "../support/repository.js";
import { createTestWorkspace } from "../support/testWorkspace.js";

const sessionFile = (producerRoot: string, relativePath: string, sessionId: string): string => {
  const path = join(producerRoot, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `{"type":"session","id":"${sessionId}","cwd":"/workspace"}\n`);
  return relativePath;
};

describe("Reviewer Transcript discovery", () => {
  it("discovers every Reviewer Transcript under each per-producer storage root", () => {
    const root = createTestWorkspace();
    const changeRoot = join(root, "change-1");
    const acceptancePath = sessionFile(
      join(changeRoot, "acceptance"),
      "reviewer-sessions/review_session-a1.jsonl",
      "session-a1",
    );
    const standardsPath = sessionFile(
      join(changeRoot, "standards"),
      "--home-agent--/review_session-s1.jsonl",
      "session-s1",
    );

    const discovery = discoverReviewerTranscripts(changeRoot, "change-1");

    expect(discovery).toEqual({
      ok: true,
      transcripts: [
        transcript("change-1", "acceptance", "session-a1", acceptancePath),
        transcript("change-1", "standards", "session-s1", standardsPath),
      ],
    });
  });

  it("retains restarted and superseded Reviewer Session files for one producer", () => {
    const root = createTestWorkspace();
    const changeRoot = join(root, "change-1");
    const acceptanceRoot = join(changeRoot, "acceptance");
    const firstPath = sessionFile(
      acceptanceRoot,
      "reviewer-sessions/review_session-first.jsonl",
      "session-first",
    );
    const restartedPath = sessionFile(
      acceptanceRoot,
      "reviewer-sessions/review_session-restarted.jsonl",
      "session-restarted",
    );

    const discovery = discoverReviewerTranscripts(changeRoot, "change-1");

    expect(discovery).toEqual({
      ok: true,
      transcripts: [
        transcript("change-1", "acceptance", "session-first", firstPath),
        transcript("change-1", "acceptance", "session-restarted", restartedPath),
      ],
    });
  });

  it("excludes another Change's Reviewer Transcript storage", () => {
    const root = createTestWorkspace();
    const changeOneRoot = join(root, "change-1");
    const changeTwoRoot = join(root, "change-2");
    const ownPath = sessionFile(
      join(changeOneRoot, "acceptance"),
      "reviewer-sessions/review_session-own.jsonl",
      "session-own",
    );
    sessionFile(
      join(changeTwoRoot, "acceptance"),
      "reviewer-sessions/review_session-other.jsonl",
      "session-other",
    );

    const discovery = discoverReviewerTranscripts(changeOneRoot, "change-1");

    expect(discovery).toEqual({
      ok: true,
      transcripts: [transcript("change-1", "acceptance", "session-own", ownPath)],
    });
  });

  it("returns an empty discovery when a Change has no Reviewer Session storage", () => {
    const root = createTestWorkspace();

    const discovery = discoverReviewerTranscripts(join(root, "change-1"), "change-1");

    expect(discovery).toEqual({ ok: true, transcripts: [] });
  });

  it("fails discovery when a JSONL file has no identifiable Pi session", () => {
    const root = createTestWorkspace();
    const changeRoot = join(root, "change-1");
    mkdirSync(join(changeRoot, "acceptance"), { recursive: true });
    writeFileSync(join(changeRoot, "acceptance", "unidentified.jsonl"), "not a session\n");

    const discovery = discoverReviewerTranscripts(changeRoot, "change-1");

    expect(discovery).toEqual({
      ok: false,
      reason: "unidentified_reviewer_session:acceptance/unidentified.jsonl",
    });
  });

  it.effect("indexes discovered Reviewer Transcripts once through persistence", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const changeRoot = join(root, "change-1");
      const acceptancePath = sessionFile(
        join(changeRoot, "acceptance"),
        "reviewer-sessions/review_session-a1.jsonl",
        "session-a1",
      );
      const recorded: ReviewerTranscript[] = [];
      const index = openReviewerTranscriptIndex({
        persistence: {
          recordReviewerTranscripts: (input) =>
            Effect.sync(() => {
              for (const transcript of input.transcripts) {
                const alreadyRecorded = recorded.some(
                  (existing) =>
                    existing.changeId === transcript.changeId &&
                    existing.producer === transcript.producer &&
                    existing.filePath === transcript.filePath,
                );
                if (!alreadyRecorded) recorded.push(transcript);
              }
            }),
        },
      });

      const first = yield* index({
        changeId: "change-1",
        reviewerSessionPath: changeRoot,
      });
      const second = yield* index({
        changeId: "change-1",
        reviewerSessionPath: changeRoot,
      });

      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      expect(recorded).toEqual([
        transcript("change-1", "acceptance", "session-a1", acceptancePath),
      ]);
    }),
  );

  it.effect("reports an index failure without recording partial references", () =>
    Effect.gen(function* () {
      const root = createTestWorkspace();
      const changeRoot = join(root, "change-1");
      mkdirSync(join(changeRoot, "acceptance"), { recursive: true });
      writeFileSync(join(changeRoot, "acceptance", "unidentified.jsonl"), "not a session\n");
      const recorded: ReviewerTranscript[] = [];
      const index = openReviewerTranscriptIndex({
        persistence: {
          recordReviewerTranscripts: (input) =>
            Effect.sync(() => {
              recorded.push(...input.transcripts);
            }),
        },
      });

      const result = yield* index({
        changeId: "change-1",
        reviewerSessionPath: changeRoot,
      });

      expect(result).toEqual({
        ok: false,
        reason: "unidentified_reviewer_session:acceptance/unidentified.jsonl",
      });
      expect(recorded).toEqual([]);
    }),
  );

  it.effect(
    "indexes retained Reviewer Transcripts through terminal cleanup with real storage",
    () =>
      withTemporaryState((input) =>
        Effect.gen(function* () {
          const repository = yield* RepositorySql;
          const changes = yield* openSqliteChangePersistence();
          const changeId = "change-e2e";
          yield* repository.operation(
            "insert terminal Change",
            (sql) =>
              sql`
            INSERT INTO changes (
              id, repository_common_directory, branch_ref, state, close_reason,
              created_at, updated_at, closed_at
            ) VALUES (
              ${changeId}, ${input.commonDirectory}, 'refs/heads/e2e',
              'closed', 'cancelled', '2026-07-25T16:30:00.000Z',
              '2026-07-25T16:30:00.000Z', '2026-07-25T16:30:00.000Z'
            )
          `,
          );
          const changeRoot = join(input.commonDirectory, "but-why", changeId);
          sessionFile(
            join(changeRoot, "acceptance"),
            "reviewer-sessions/review_session-a1.jsonl",
            "session-a1",
          );
          sessionFile(
            join(changeRoot, "acceptance"),
            "reviewer-sessions/review_session-a2.jsonl",
            "session-a2",
          );
          sessionFile(
            join(changeRoot, "standards"),
            "--home-agent--/review_session-s1.jsonl",
            "session-s1",
          );
          yield* changes.saveReviewerSession({
            changeId,
            producer: "acceptance",
            fingerprint: "fingerprint",
            sessionReference: "session-a1",
          });

          const cleanup = openTerminalCleanup({
            persistence: changes,
            cleanup: () => ({ state: "complete" as const, blockingReason: null }),
            indexTranscripts: openReviewerTranscriptIndex({ persistence: changes }),
            reviewerSessionPathFor: (change) => join(input.commonDirectory, "but-why", change),
          });

          const result = yield* cleanup(closedChange(changeId, input.commonDirectory), now);

          expect(result).toMatchObject({ ok: true, cleanup: { state: "complete" } });
          const transcripts = yield* changes.listReviewerTranscripts(changeId);
          expect(transcripts).toEqual([
            {
              changeId,
              producer: "acceptance",
              piSessionId: "session-a1",
              filePath: "reviewer-sessions/review_session-a1.jsonl",
            },
            {
              changeId,
              producer: "acceptance",
              piSessionId: "session-a2",
              filePath: "reviewer-sessions/review_session-a2.jsonl",
            },
            {
              changeId,
              producer: "standards",
              piSessionId: "session-s1",
              filePath: "--home-agent--/review_session-s1.jsonl",
            },
          ]);
          const live = yield* changes.getReviewerSession(changeId, "acceptance");
          expect(live).toBeUndefined();
          const retained = yield* Effect.sync(() => existsSync(join(changeRoot, "acceptance")));
          expect(retained).toBe(true);
        }),
      ),
  );
});

const now = "2026-07-25T16:30:00.000Z";

const closedChange = (changeId: string, commonDirectory: string): ChangeRecord => ({
  id: changeId,
  repositoryCommonDirectory: commonDirectory,
  branchRef: "refs/heads/e2e",
  baseRef: null,
  baseRemoteUrl: null,
  taskId: null,
  startingCommit: null,
  worktreePath: null,
  acceptanceContext: null,
  prepare: null,
  prepareFailure: null,
  publication: null,
  cleanup: { state: "pending", blockingReason: null },
  state: "closed",
  closeReason: "cancelled",
  cancelReason: null,
  createdAt: now,
  updatedAt: now,
  closedAt: now,
});

const transcript = (
  changeId: string,
  producer: string,
  piSessionId: string,
  filePath: string,
): ReviewerTranscript => ({ changeId, producer, piSessionId, filePath });
