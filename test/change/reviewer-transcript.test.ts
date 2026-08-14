import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import {
  discoverReviewerTranscripts,
  type ReviewerTranscript,
} from "../../src/change/reviewerSession/reviewerTranscript.js";
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

  it("falls back to the filename when a transcript header is a non-object JSON value", () => {
    const root = createTestWorkspace();
    const changeRoot = join(root, "change-1");
    const producerRoot = join(changeRoot, "acceptance");
    const relativePath = "reviewer-sessions/review_session-fallback.jsonl";
    const path = join(producerRoot, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "null\n");

    const discovery = discoverReviewerTranscripts(changeRoot, "change-1");

    expect(discovery).toEqual({
      ok: true,
      transcripts: [transcript("change-1", "acceptance", "session-fallback", relativePath)],
    });
  });
});

const transcript = (
  changeId: string,
  producer: string,
  piSessionId: string,
  filePath: string,
): ReviewerTranscript => ({ changeId, producer, piSessionId, filePath });
